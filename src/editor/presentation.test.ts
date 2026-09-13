import { describe, expect, it, vi } from 'vitest'

import { NodePresentationManager } from './presentation'

function createManager(onChange = vi.fn()) {
  return { manager: new NodePresentationManager({ onChange }), onChange }
}

describe('NodePresentationManager - explicit collapse', () => {
  it('starts a new node expanded', () => {
    const { manager } = createManager()
    expect(manager.isExpanded('node')).toBe(true)
    expect(manager.isCollapsed('node')).toBe(false)
  })

  it('collapses a node explicitly', () => {
    const { manager, onChange } = createManager()
    manager.setCollapsed('node', true)
    expect(manager.isCollapsed('node')).toBe(true)
    expect(manager.isExpanded('node')).toBe(false)
    expect(onChange).toHaveBeenCalledWith('node')
  })

  it('expands a collapsed node explicitly', () => {
    const { manager } = createManager()
    manager.setCollapsed('node', true)
    manager.setCollapsed('node', false)
    expect(manager.isExpanded('node')).toBe(true)
  })

  it('toggles between expanded and collapsed', () => {
    const { manager, onChange } = createManager()
    manager.toggleCollapsed('node')
    manager.toggleCollapsed('node')
    expect(manager.isExpanded('node')).toBe(true)
    expect(onChange).toHaveBeenCalledTimes(2)
  })

  it('does not notify when setting an already-collapsed node', () => {
    const { manager, onChange } = createManager()
    manager.setCollapsed('node', true)
    onChange.mockClear()
    manager.setCollapsed('node', true)
    expect(onChange).not.toHaveBeenCalled()
  })

  it('does not notify when setting a new node to its expanded default', () => {
    const { manager, onChange } = createManager()
    manager.setCollapsed('node', false)
    expect(onChange).not.toHaveBeenCalled()
  })

  it('keeps collapse state isolated by node id', () => {
    const { manager } = createManager()
    manager.setCollapsed('left', true)
    expect(manager.isCollapsed('left')).toBe(true)
    expect(manager.isExpanded('right')).toBe(true)
  })

  it('uses explicit expansion for the complete interactive body', () => {
    const { manager } = createManager()
    expect(manager.isInteractivelyExpanded('node')).toBe(true)
    manager.setCollapsed('node', true)
    expect(manager.isInteractivelyExpanded('node')).toBe(false)
  })

  it('survives repeated explicit collapse cycles', () => {
    const { manager, onChange } = createManager()
    for (let index = 0; index < 5; index += 1) {
      manager.toggleCollapsed('node')
      manager.toggleCollapsed('node')
    }
    expect(manager.isExpanded('node')).toBe(true)
    expect(onChange).toHaveBeenCalledTimes(10)
  })
})

describe('NodePresentationManager - connected compact rows', () => {
  it('starts with no connected parameter inputs', () => {
    const { manager } = createManager()
    expect(manager.getConnectedInputKeys('node')).toEqual(new Set())
  })

  it('returns the exact connected parameter keys', () => {
    const { manager } = createManager()
    manager.setConnectedInputs('node', new Set(['x', 'z']))
    expect([...manager.getConnectedInputKeys('node')]).toEqual(['x', 'z'])
  })

  it('copies the supplied key set instead of retaining caller-owned state', () => {
    const { manager } = createManager()
    const keys = new Set(['x'])
    manager.setConnectedInputs('node', keys)
    keys.add('y')
    expect([...manager.getConnectedInputKeys('node')]).toEqual(['x'])
  })

  it('does not notify when connected keys are unchanged', () => {
    const { manager, onChange } = createManager()
    manager.setConnectedInputs('node', new Set(['x', 'z']))
    onChange.mockClear()
    manager.setConnectedInputs('node', new Set(['z', 'x']))
    expect(onChange).not.toHaveBeenCalled()
  })

  it('notifies only the affected node when connected keys change', () => {
    const { manager, onChange } = createManager()
    manager.setConnectedInputs('node', new Set(['x']))
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith('node')
  })

  it('does not change explicit expansion when a parameter connects', () => {
    const { manager } = createManager()
    manager.setConnectedInputs('node', new Set(['x']))
    expect(manager.isExpanded('node')).toBe(true)
    manager.setCollapsed('node', true)
    manager.setConnectedInputs('node', new Set(['x', 'y']))
    expect(manager.isCollapsed('node')).toBe(true)
  })

  it('retains connected anchors while collapsing', () => {
    const { manager } = createManager()
    manager.setConnectedInputs('node', new Set(['a']))
    manager.setCollapsed('node', true)
    expect(manager.getConnectedInputKeys('node')).toEqual(new Set(['a']))
  })

  it('retains connected anchors while expanding', () => {
    const { manager } = createManager()
    manager.setCollapsed('node', true)
    manager.setConnectedInputs('node', new Set(['a']))
    manager.setCollapsed('node', false)
    expect(manager.getConnectedInputKeys('node')).toEqual(new Set(['a']))
  })

  it('clears connected keys without changing collapse state', () => {
    const { manager } = createManager()
    manager.setCollapsed('node', true)
    manager.setConnectedInputs('node', new Set(['a']))
    manager.setConnectedInputs('node', new Set())
    expect(manager.getConnectedInputKeys('node')).toEqual(new Set())
    expect(manager.isCollapsed('node')).toBe(true)
  })
})

describe('NodePresentationManager - cleanup', () => {
  it('removing a node resets its collapse state to expanded', () => {
    const { manager } = createManager()
    manager.setCollapsed('node', true)
    manager.remove('node')
    expect(manager.isExpanded('node')).toBe(true)
  })

  it('removing a node clears its connected-input state', () => {
    const { manager } = createManager()
    manager.setConnectedInputs('node', new Set(['a']))
    manager.remove('node')
    expect(manager.getConnectedInputKeys('node')).toEqual(new Set())
  })
})

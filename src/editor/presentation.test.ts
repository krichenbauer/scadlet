import { describe, expect, it, vi } from 'vitest'

import { NodePresentationManager } from './presentation'

function createManager(onChange = vi.fn()) {
  return { manager: new NodePresentationManager({ onChange }), onChange }
}

describe('NodePresentationManager', () => {
  it('starts nodes expanded and toggles only through the explicit collapse state', () => {
    const { manager, onChange } = createManager()
    expect(manager.isExpanded('node')).toBe(true)
    expect(manager.isCollapsed('node')).toBe(false)

    manager.toggleCollapsed('node')
    expect(manager.isCollapsed('node')).toBe(true)
    expect(manager.isExpanded('node')).toBe(false)
    manager.toggleCollapsed('node')
    expect(manager.isExpanded('node')).toBe(true)
    expect(onChange).toHaveBeenCalledTimes(2)
  })

  it('does not let connection disclosure change explicit collapse state', () => {
    const { manager } = createManager()
    manager.setCollapsed('node', true)
    manager.setConnectionDisclosure('node', new Set(['x', 'z']))

    expect(manager.isCollapsed('node')).toBe(true)
    expect([...manager.getDisclosedInputKeys('node')]).toEqual(['x', 'z'])
    manager.setConnectionDisclosure('node', new Set())
    expect(manager.isCollapsed('node')).toBe(true)
  })

  it('keeps connected input anchors independently from collapse state', () => {
    const { manager } = createManager()
    manager.setCollapsed('node', true)
    manager.setConnectedInputs('node', new Set(['a']))
    expect([...manager.getConnectedInputKeys('node')]).toEqual(['a'])
    expect(manager.isCollapsed('node')).toBe(true)
  })

  it('removes all presentation state when a node is removed', () => {
    const { manager } = createManager()
    manager.setCollapsed('node', true)
    manager.setConnectionDisclosure('node', new Set(['a']))
    manager.remove('node')
    expect(manager.isExpanded('node')).toBe(true)
    expect(manager.getDisclosedInputKeys('node')).toEqual(new Set())
  })
})

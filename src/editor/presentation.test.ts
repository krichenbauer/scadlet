import { ClassicPreset, NodeEditor } from 'rete'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { CubeNode } from './nodes/cube-node'
import { CylinderNode } from './nodes/cylinder-node'
import { DifferenceNode } from './nodes/difference-node'
import { NodePresentationManager } from './presentation'
import type { Schemes } from './schemes'

function createManager(hoverCapable: boolean, onChange = vi.fn()) {
  const manager = new NodePresentationManager({
    onChange,
    hoverCapable: () => hoverCapable,
    expandDelayMs: 600,
    collapseDelayMs: 800,
  })
  return { manager, onChange }
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('NodePresentationManager - defaults', () => {
  it('starts every node collapsed and unpinned', () => {
    const { manager } = createManager(true)
    expect(manager.isExpanded('a')).toBe(false)
    expect(manager.isPinned('a')).toBe(false)
  })
})

describe('NodePresentationManager - desktop hover', () => {
  it('expands after the configured hover delay', () => {
    const { manager, onChange } = createManager(true)
    manager.handlePointerEnter('a')
    expect(manager.isExpanded('a')).toBe(false)

    vi.advanceTimersByTime(599)
    expect(manager.isExpanded('a')).toBe(false)

    vi.advanceTimersByTime(1)
    expect(manager.isExpanded('a')).toBe(true)
    expect(onChange).toHaveBeenCalledWith('a')
  })

  it('does not expand on a fast pointer fly-by', () => {
    const { manager, onChange } = createManager(true)
    manager.handlePointerEnter('a')
    vi.advanceTimersByTime(200)
    manager.handlePointerLeave('a')

    vi.advanceTimersByTime(5000)
    expect(manager.isExpanded('a')).toBe(false)
    expect(onChange).not.toHaveBeenCalled()
  })

  it('collapses again after the leave delay', () => {
    const { manager } = createManager(true)
    manager.handlePointerEnter('a')
    vi.advanceTimersByTime(600)
    expect(manager.isExpanded('a')).toBe(true)

    manager.handlePointerLeave('a')
    vi.advanceTimersByTime(799)
    expect(manager.isExpanded('a')).toBe(true)

    vi.advanceTimersByTime(1)
    expect(manager.isExpanded('a')).toBe(false)
  })

  it('re-entering before the leave delay elapses cancels the pending collapse', () => {
    const { manager } = createManager(true)
    manager.handlePointerEnter('a')
    vi.advanceTimersByTime(600)
    manager.handlePointerLeave('a')
    vi.advanceTimersByTime(400)
    manager.handlePointerEnter('a')

    vi.advanceTimersByTime(800)
    expect(manager.isExpanded('a')).toBe(true)
  })

  it('never expands on a device without real hover capability', () => {
    const { manager } = createManager(false)
    manager.handlePointerEnter('a')
    vi.advanceTimersByTime(10_000)
    expect(manager.isExpanded('a')).toBe(false)
  })
})

describe('NodePresentationManager - pinning', () => {
  it('pinning expands immediately and prevents auto-collapse', () => {
    const { manager } = createManager(true)
    manager.togglePin('a')
    expect(manager.isExpanded('a')).toBe(true)
    expect(manager.isPinned('a')).toBe(true)

    manager.handlePointerEnter('a')
    manager.handlePointerLeave('a')
    vi.advanceTimersByTime(10_000)
    expect(manager.isExpanded('a')).toBe(true)
  })

  it('unpinning collapses immediately and restores auto-expand/collapse behavior', () => {
    const { manager } = createManager(true)
    manager.togglePin('a')
    manager.togglePin('a')
    expect(manager.isPinned('a')).toBe(false)
    expect(manager.isExpanded('a')).toBe(false)

    manager.handlePointerEnter('a')
    vi.advanceTimersByTime(600)
    expect(manager.isExpanded('a')).toBe(true)

    manager.handlePointerLeave('a')
    vi.advanceTimersByTime(800)
    expect(manager.isExpanded('a')).toBe(false)
  })
})

describe('NodePresentationManager - touch/no-hover', () => {
  it('selecting a collapsed node expands it immediately', () => {
    const { manager, onChange } = createManager(false)
    manager.handleSelected('a')
    expect(manager.isExpanded('a')).toBe(true)
    expect(onChange).toHaveBeenCalledWith('a')
  })

  it('deselecting an unpinned expanded node collapses it', () => {
    const { manager } = createManager(false)
    manager.handleSelected('a')
    manager.handleDeselected('a')
    expect(manager.isExpanded('a')).toBe(false)
  })

  it('deselecting a pinned node does not collapse it', () => {
    const { manager } = createManager(false)
    manager.togglePin('a')
    manager.handleDeselected('a')
    expect(manager.isExpanded('a')).toBe(true)
  })

  it('does not react to selection on a hover-capable device', () => {
    const { manager, onChange } = createManager(true)
    manager.handleSelected('a')
    expect(manager.isExpanded('a')).toBe(false)
    expect(onChange).not.toHaveBeenCalled()
  })

  it('syncSelection only fires on an actual transition, deferred to a microtask', async () => {
    const { manager, onChange } = createManager(false)
    manager.syncSelection('a', true)
    manager.syncSelection('a', true)
    expect(onChange).not.toHaveBeenCalled()

    await Promise.resolve()
    expect(manager.isExpanded('a')).toBe(true)
    expect(onChange).toHaveBeenCalledTimes(1)

    manager.syncSelection('a', false)
    await Promise.resolve()
    expect(manager.isExpanded('a')).toBe(false)
  })
})

describe('NodePresentationManager - timer cleanup', () => {
  it('clears pending timers and state when a node is removed', () => {
    const { manager, onChange } = createManager(true)
    manager.handlePointerEnter('a')
    manager.remove('a')

    vi.advanceTimersByTime(10_000)
    expect(onChange).not.toHaveBeenCalled()
    // A fresh lookup after removal starts collapsed again, proving no stale state lingers.
    expect(manager.isExpanded('a')).toBe(false)
  })

  it('explicit collapse (via unpin) cancels any pending auto-expand timer', () => {
    const { manager, onChange } = createManager(true)
    manager.togglePin('a')
    manager.handlePointerEnter('a') // no-op: already expanded/pinned
    manager.togglePin('a') // unpin -> collapse
    onChange.mockClear()

    vi.advanceTimersByTime(10_000)
    expect(manager.isExpanded('a')).toBe(false)
    expect(onChange).not.toHaveBeenCalled()
  })
})

describe('NodePresentationManager - isolation from graph/node semantics', () => {
  it('never touches node parameters, controls, or connections', async () => {
    const editor = new NodeEditor<Schemes>()
    const cube = new CubeNode({ sizeX: 5 })
    const cylinder = new CylinderNode()
    const difference = new DifferenceNode()
    await editor.addNode(cube)
    await editor.addNode(cylinder)
    await editor.addNode(difference)
    const connection = new ClassicPreset.Connection<ClassicPreset.Node, ClassicPreset.Node>(
      cube,
      'geometry',
      difference,
      'base',
    )
    await editor.addConnection(connection)

    const { manager } = createManager(true)
    manager.handlePointerEnter(cube.id)
    vi.advanceTimersByTime(600)
    manager.togglePin(cylinder.id)
    manager.handleSelected(difference.id) // no-op: hover-capable

    // Cylinder's mode/optional-parameter progressive disclosure is untouched.
    expect(cylinder.controls.mode.value).toBe('radius')
    expect(cylinder.controls.r).toBeDefined()
    expect(cylinder.controls.fn).toBeUndefined()

    // Cube's params are untouched.
    expect(cube.controls.sizeX.value).toBe(5)

    // The graph structure is untouched.
    expect(editor.getNodes().map((node) => node.id).sort()).toEqual(
      [cube.id, cylinder.id, difference.id].sort(),
    )
    expect(editor.getConnections()).toEqual([connection])
  })
})

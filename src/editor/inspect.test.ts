import { describe, expect, it, vi } from 'vitest'

import { InspectManager } from './inspect'

describe('InspectManager', () => {
  it('starts with no node inspected', () => {
    const manager = new InspectManager({ onChange: vi.fn() })
    expect(manager.id).toBeNull()
    expect(manager.isInspected('a')).toBe(false)
  })

  it('marks exactly the node whose successful Geometry Inspect was committed', () => {
    const onChange = vi.fn()
    const manager = new InspectManager({ onChange })

    manager.commitGeometry('a')

    expect(manager.id).toBe('a')
    expect(manager.isInspected('a')).toBe(true)
    expect(onChange).toHaveBeenCalledExactlyOnceWith('a')
  })

  it('moves the marker only when a second Geometry Inspect succeeds', () => {
    const onChange = vi.fn()
    const manager = new InspectManager({ onChange })
    manager.commitGeometry('a')
    onChange.mockClear()

    // A failed attempt has no commit, so the previous preview provenance is
    // retained rather than being replaced by a pending DOM-only marker.
    expect(manager.id).toBe('a')
    manager.commitGeometry('b')

    expect(manager.id).toBe('b')
    expect(manager.isInspected('a')).toBe(false)
    expect(manager.isInspected('b')).toBe(true)
    expect(onChange).toHaveBeenCalledTimes(2)
    expect(onChange).toHaveBeenCalledWith('a')
    expect(onChange).toHaveBeenCalledWith('b')
  })

  it('removing a node that is not inspected does nothing', () => {
    const onChange = vi.fn()
    const manager = new InspectManager({ onChange })
    manager.commitGeometry('a')
    onChange.mockClear()

    manager.remove('b')

    expect(manager.id).toBe('a')
    expect(onChange).not.toHaveBeenCalled()
  })

  it('removing the inspected node clears inspection and notifies onChange', () => {
    const onChange = vi.fn()
    const manager = new InspectManager({ onChange })
    manager.commitGeometry('a')
    onChange.mockClear()

    manager.remove('a')

    expect(manager.id).toBeNull()
    expect(onChange).toHaveBeenCalledExactlyOnceWith('a')
  })

  it('clears the marker and transient value result for normal Render or a committed semantic change', () => {
    const onChange = vi.fn()
    const manager = new InspectManager({ onChange })
    manager.commitGeometry('geometry')
    onChange.mockClear()

    manager.clear()

    expect(manager.id).toBeNull()
    expect(manager.isInspected('geometry')).toBe(false)
    expect(onChange).toHaveBeenCalledExactlyOnceWith('geometry')
  })

  it('clears a committed Value Inspect and its displayed result on a semantic change', () => {
    const manager = new InspectManager({ onChange: vi.fn() })
    manager.commitValue('value', '12')

    manager.clear()

    expect(manager.id).toBeNull()
    expect(manager.getValueResult('value')).toBeNull()
  })

  it('moves between Value and Geometry Inspect without leaving either stale state behind', () => {
    const manager = new InspectManager({ onChange: vi.fn() })
    manager.commitValue('value', '15')
    expect(manager.getValueResult('value')).toBe('15')
    manager.commitGeometry('geometry')
    expect(manager.getValueResult('value')).toBeNull()
    expect(manager.getValueResult('geometry')).toBeNull()
    expect(manager.isInspected('geometry')).toBe(true)
    manager.commitValue('value-2', '42')
    expect(manager.isInspected('geometry')).toBe(false)
    expect(manager.getValueResult('value-2')).toBe('42')
  })
})

describe('InspectManager.registerPointerDown', () => {
  it('does nothing on a single pointerdown', () => {
    const onChange = vi.fn()
    let time = 0
    const manager = new InspectManager({ onChange, now: () => time })

    manager.registerPointerDown('a')

    expect(manager.id).toBeNull()
    expect(onChange).not.toHaveBeenCalled()
  })

  it('starts an inspection attempt on a second pointerdown without changing provenance', () => {
    const onChange = vi.fn()
    let time = 0
    const manager = new InspectManager({ onChange, now: () => time, doubleClickThresholdMs: 400 })

    manager.registerPointerDown('a')
    time = 200
    expect(manager.registerPointerDown('a')).toBe(true)

    expect(manager.id).toBeNull()
    expect(onChange).not.toHaveBeenCalled()
  })

  it('does not inspect when the second pointerdown exceeds the threshold', () => {
    const onChange = vi.fn()
    let time = 0
    const manager = new InspectManager({ onChange, now: () => time, doubleClickThresholdMs: 400 })

    manager.registerPointerDown('a')
    time = 401
    manager.registerPointerDown('a')

    expect(manager.id).toBeNull()
    expect(onChange).not.toHaveBeenCalled()
  })

  it('does not inspect when the second pointerdown is on a different node', () => {
    const onChange = vi.fn()
    let time = 0
    const manager = new InspectManager({ onChange, now: () => time, doubleClickThresholdMs: 400 })

    manager.registerPointerDown('a')
    time = 100
    manager.registerPointerDown('b')

    expect(manager.id).toBeNull()
    expect(onChange).not.toHaveBeenCalled()
  })

  it('resets the pending pointerdown after an attempt, requiring two fresh pointerdowns to inspect again', () => {
    const onChange = vi.fn()
    let time = 0
    const manager = new InspectManager({ onChange, now: () => time, doubleClickThresholdMs: 400 })

    manager.registerPointerDown('a')
    time = 100
    manager.registerPointerDown('a')
    manager.commitGeometry('a')
    expect(manager.id).toBe('a')

    time = 150
    manager.registerPointerDown('a')

    expect(manager.id).toBe('a')
  })

  it('does not disturb an existing marker during a new pending or failed attempt', () => {
    const onChange = vi.fn()
    let time = 0
    const manager = new InspectManager({ onChange, now: () => time, doubleClickThresholdMs: 400 })

    manager.commitGeometry('a')
    manager.registerPointerDown('b')
    time = 100
    manager.registerPointerDown('b')
    expect(manager.id).toBe('a')

    time = 200
    manager.registerPointerDown('b')
    time = 250
    manager.registerPointerDown('b')

    expect(manager.id).toBe('a')
  })

  it('keeps a successful marker through presentation-only pointer interaction', () => {
    const manager = new InspectManager({ onChange: vi.fn(), now: () => 0 })
    manager.commitGeometry('a')

    manager.registerPointerDown('a')

    expect(manager.id).toBe('a')
    expect(manager.isInspected('a')).toBe(true)
  })
})

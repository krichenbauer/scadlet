import { describe, expect, it, vi } from 'vitest'

import { InspectManager } from './inspect'

describe('InspectManager', () => {
  it('starts with no node inspected', () => {
    const manager = new InspectManager({ onChange: vi.fn() })
    expect(manager.id).toBeNull()
    expect(manager.isInspected('a')).toBe(false)
  })

  it('toggling a node inspects it and notifies onChange for it', () => {
    const onChange = vi.fn()
    const manager = new InspectManager({ onChange })

    manager.toggle('a')

    expect(manager.id).toBe('a')
    expect(manager.isInspected('a')).toBe(true)
    expect(onChange).toHaveBeenCalledExactlyOnceWith('a')
  })

  it('toggling the currently inspected node clears inspection', () => {
    const onChange = vi.fn()
    const manager = new InspectManager({ onChange })
    manager.toggle('a')
    onChange.mockClear()

    manager.toggle('a')

    expect(manager.id).toBeNull()
    expect(manager.isInspected('a')).toBe(false)
    expect(onChange).toHaveBeenCalledExactlyOnceWith('a')
  })

  it('toggling a different node replaces the previous inspect root and notifies both', () => {
    const onChange = vi.fn()
    const manager = new InspectManager({ onChange })
    manager.toggle('a')
    onChange.mockClear()

    manager.toggle('b')

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
    manager.toggle('a')
    onChange.mockClear()

    manager.remove('b')

    expect(manager.id).toBe('a')
    expect(onChange).not.toHaveBeenCalled()
  })

  it('removing the inspected node clears inspection and notifies onChange', () => {
    const onChange = vi.fn()
    const manager = new InspectManager({ onChange })
    manager.toggle('a')
    onChange.mockClear()

    manager.remove('a')

    expect(manager.id).toBeNull()
    expect(onChange).toHaveBeenCalledExactlyOnceWith('a')
  })

  it('keeps an inspected value result transient and clears it when inspection changes', () => {
    const manager = new InspectManager({ onChange: vi.fn() })
    manager.toggle('value')
    manager.setValueResult('value', '15')
    expect(manager.getValueResult('value')).toBe('15')
    manager.toggle('geometry')
    expect(manager.getValueResult('value')).toBeNull()
    expect(manager.getValueResult('geometry')).toBeNull()
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

  it('toggles inspection on a second pointerdown on the same node within the threshold', () => {
    const onChange = vi.fn()
    let time = 0
    const manager = new InspectManager({ onChange, now: () => time, doubleClickThresholdMs: 400 })

    manager.registerPointerDown('a')
    time = 200
    manager.registerPointerDown('a')

    expect(manager.id).toBe('a')
    expect(onChange).toHaveBeenCalledExactlyOnceWith('a')
  })

  it('does not toggle when the second pointerdown exceeds the threshold', () => {
    const onChange = vi.fn()
    let time = 0
    const manager = new InspectManager({ onChange, now: () => time, doubleClickThresholdMs: 400 })

    manager.registerPointerDown('a')
    time = 401
    manager.registerPointerDown('a')

    expect(manager.id).toBeNull()
    expect(onChange).not.toHaveBeenCalled()
  })

  it('does not toggle when the second pointerdown is on a different node', () => {
    const onChange = vi.fn()
    let time = 0
    const manager = new InspectManager({ onChange, now: () => time, doubleClickThresholdMs: 400 })

    manager.registerPointerDown('a')
    time = 100
    manager.registerPointerDown('b')

    expect(manager.id).toBeNull()
    expect(onChange).not.toHaveBeenCalled()
  })

  it('resets the pending pointerdown after a toggle, requiring two fresh pointerdowns to toggle again', () => {
    const onChange = vi.fn()
    let time = 0
    const manager = new InspectManager({ onChange, now: () => time, doubleClickThresholdMs: 400 })

    manager.registerPointerDown('a')
    time = 100
    manager.registerPointerDown('a')
    expect(manager.id).toBe('a')

    time = 150
    manager.registerPointerDown('a')

    expect(manager.id).toBe('a')
  })

  it('a third rapid pointerdown on the same node toggles inspection off again', () => {
    const onChange = vi.fn()
    let time = 0
    const manager = new InspectManager({ onChange, now: () => time, doubleClickThresholdMs: 400 })

    manager.registerPointerDown('a')
    time = 100
    manager.registerPointerDown('a')
    expect(manager.id).toBe('a')

    time = 200
    manager.registerPointerDown('a')
    time = 250
    manager.registerPointerDown('a')

    expect(manager.id).toBeNull()
  })
})

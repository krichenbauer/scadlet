import { describe, expect, it, vi } from 'vitest'

import { ConnectionGestureManager, nearestSnapTarget } from './connection-gesture'

const numberOrigin = { nodeId: 'number', socketKey: 'value', side: 'output' as const, socketType: 'number' as const }
const numberTarget = { nodeId: 'cube', socketKey: 'size', side: 'input' as const }

describe('ConnectionGestureManager', () => {
  it('starts one gesture with no snap target', () => {
    const gesture = new ConnectionGestureManager()
    gesture.begin(numberOrigin)
    expect(gesture.active).toEqual({ origin: numberOrigin, snapTarget: null })
  })

  it('replaces an old gesture when another socket is picked', () => {
    const gesture = new ConnectionGestureManager()
    gesture.begin(numberOrigin)
    const inputOrigin = { nodeId: 'cube', socketKey: 'size', side: 'input' as const, socketType: 'number' as const }
    gesture.begin(inputOrigin)
    expect(gesture.active?.origin).toEqual(inputOrigin)
  })

  it('tracks a visible compatible snap target without changing the origin', () => {
    const gesture = new ConnectionGestureManager()
    gesture.begin(numberOrigin)
    gesture.setSnapTarget(numberTarget)
    expect(gesture.active).toEqual({ origin: numberOrigin, snapTarget: numberTarget })
  })

  it('does not notify twice for the same snap target', () => {
    const gesture = new ConnectionGestureManager()
    const listener = vi.fn()
    gesture.subscribe(listener)
    gesture.begin(numberOrigin)
    gesture.setSnapTarget(numberTarget)
    gesture.setSnapTarget({ ...numberTarget })
    expect(listener).toHaveBeenCalledTimes(2)
  })

  it('clears a snap target while keeping the same active gesture', () => {
    const gesture = new ConnectionGestureManager()
    gesture.begin(numberOrigin)
    gesture.setSnapTarget(numberTarget)
    gesture.setSnapTarget(null)
    expect(gesture.active).toEqual({ origin: numberOrigin, snapTarget: null })
  })

  it('completes the active gesture', () => {
    const gesture = new ConnectionGestureManager()
    gesture.begin(numberOrigin)
    gesture.complete()
    expect(gesture.active).toBeNull()
  })

  it('cancels the active gesture', () => {
    const gesture = new ConnectionGestureManager()
    gesture.begin(numberOrigin)
    gesture.cancel()
    expect(gesture.active).toBeNull()
  })

  it('removing the origin cancels the gesture', () => {
    const gesture = new ConnectionGestureManager()
    gesture.begin(numberOrigin)
    gesture.setSnapTarget(numberTarget)
    gesture.removeNode('number')
    expect(gesture.active).toBeNull()
  })

  it('removing the snapped node retains the gesture but clears the target', () => {
    const gesture = new ConnectionGestureManager()
    gesture.begin(numberOrigin)
    gesture.setSnapTarget(numberTarget)
    gesture.removeNode('cube')
    expect(gesture.active).toEqual({ origin: numberOrigin, snapTarget: null })
  })

  it('removing an unrelated node changes nothing', () => {
    const gesture = new ConnectionGestureManager()
    gesture.begin(numberOrigin)
    gesture.setSnapTarget(numberTarget)
    gesture.removeNode('sphere')
    expect(gesture.active).toEqual({ origin: numberOrigin, snapTarget: numberTarget })
  })

  it('resets all transient gesture state', () => {
    const gesture = new ConnectionGestureManager()
    gesture.begin(numberOrigin)
    gesture.setSnapTarget(numberTarget)
    gesture.reset()
    expect(gesture.active).toBeNull()
  })

  it('stops notifying an unsubscribed listener', () => {
    const gesture = new ConnectionGestureManager()
    const listener = vi.fn()
    const unsubscribe = gesture.subscribe(listener)
    gesture.begin(numberOrigin)
    unsubscribe()
    gesture.complete()
    expect(listener).toHaveBeenCalledTimes(1)
  })
})

describe('nearestSnapTarget', () => {
  const candidates = [
    { nodeId: 'number-target', socketKey: 'a', side: 'input' as const, socketType: 'number' as const, x: 100, y: 100, canConnect: true },
    { nodeId: 'other-number-target', socketKey: 'b', side: 'input' as const, socketType: 'number' as const, x: 120, y: 100, canConnect: true },
    { nodeId: 'vector-target', socketKey: 'vector', side: 'input' as const, socketType: 'vector3' as const, x: 101, y: 100, canConnect: true },
    { nodeId: 'number-output', socketKey: 'value', side: 'output' as const, socketType: 'number' as const, x: 101, y: 100, canConnect: true },
  ]

  it('chooses the nearest compatible opposite-side socket', () => {
    expect(nearestSnapTarget(numberOrigin, candidates, { x: 104, y: 100 })).toMatchObject({ nodeId: 'number-target', socketKey: 'a' })
    expect(nearestSnapTarget(numberOrigin, candidates, { x: 118, y: 100 })).toMatchObject({ nodeId: 'other-number-target', socketKey: 'b' })
  })

  it('rejects incompatible and same-direction sockets', () => {
    expect(nearestSnapTarget(numberOrigin, candidates.slice(2), { x: 101, y: 100 })).toBeNull()
  })

  it('rejects unavailable and distant sockets', () => {
    expect(nearestSnapTarget(numberOrigin, [{ ...candidates[0]!, canConnect: false }], { x: 100, y: 100 })).toBeNull()
    expect(nearestSnapTarget(numberOrigin, [candidates[0]!], { x: 200, y: 100 })).toBeNull()
  })

  it('includes a target exactly on the snap radius', () => {
    expect(nearestSnapTarget(numberOrigin, [candidates[0]!], { x: 128, y: 100 })).toMatchObject({ nodeId: 'number-target' })
  })

  it('breaks an equal-distance tie by stable node and port ids', () => {
    const tied = [
      { ...candidates[0]!, nodeId: 'z-node', socketKey: 'z' },
      { ...candidates[0]!, nodeId: 'a-node', socketKey: 'b' },
      { ...candidates[0]!, nodeId: 'a-node', socketKey: 'a' },
    ]
    expect(nearestSnapTarget(numberOrigin, tied, { x: 100, y: 100 })).toMatchObject({ nodeId: 'a-node', socketKey: 'a' })
  })
})

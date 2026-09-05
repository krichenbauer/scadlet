import { describe, expect, it } from 'vitest'

import { compatiblePortKeys, ConnectionGestureManager, nearestSnapTarget } from './connection-gesture'

const numberOrigin = { nodeId: 'number', socketKey: 'value', side: 'output' as const, socketType: 'number' as const }

describe('ConnectionGestureManager', () => {
  it('tracks one explicit active gesture and moves its candidate before completion', () => {
    const gesture = new ConnectionGestureManager()
    gesture.begin(numberOrigin)
    expect(gesture.active).toEqual({ origin: numberOrigin, candidateNodeId: null, snapTarget: null })

    gesture.setCandidate('cube-a')
    expect(gesture.active?.candidateNodeId).toBe('cube-a')
    gesture.setCandidate('cube-b')
    expect(gesture.active?.candidateNodeId).toBe('cube-b')

    gesture.complete()
    expect(gesture.active).toBeNull()
  })

  it('clears the candidate on cancellation and resets completely when the source is removed', () => {
    const gesture = new ConnectionGestureManager()
    gesture.begin(numberOrigin)
    gesture.setCandidate('cube')
    gesture.cancel()
    expect(gesture.active).toBeNull()

    gesture.begin(numberOrigin)
    gesture.setCandidate('cube')
    gesture.removeNode('number')
    expect(gesture.active).toBeNull()
  })

  it('clears only a removed candidate while keeping its active source gesture', () => {
    const gesture = new ConnectionGestureManager()
    gesture.begin(numberOrigin)
    gesture.setCandidate('cube')
    gesture.removeNode('cube')
    expect(gesture.active).toEqual({ origin: numberOrigin, candidateNodeId: null, snapTarget: null })
  })

  it('clears all transient state when the editor interaction resets', () => {
    const gesture = new ConnectionGestureManager()
    gesture.begin(numberOrigin)
    gesture.setCandidate('cube')
    gesture.reset()
    expect(gesture.active).toBeNull()
  })
})

describe('compatiblePortKeys', () => {
  const ports = {
    geometry: { socket: { name: 'geometry' } },
    number: { socket: { name: 'number' } },
    vector: { socket: { name: 'vector3' } },
    boolean: { socket: { name: 'boolean' } },
  }

  it.each([
    ['geometry', ['geometry']],
    ['number', ['number']],
    ['vector3', ['vector']],
    ['boolean', ['boolean']],
  ] as const)('returns only %s-compatible existing ports', (type, expected) => {
    expect(compatiblePortKeys(ports, type)).toEqual(expected)
  })

  it('does not disclose a Vector3-only port for a Number gesture', () => {
    expect(compatiblePortKeys({ vector: ports.vector }, 'number')).toEqual([])
  })
})

describe('nearestSnapTarget', () => {
  const candidates = [
    { nodeId: 'number-target', socketKey: 'a', side: 'input' as const, socketType: 'number' as const, x: 100, y: 100, canConnect: true },
    { nodeId: 'other-number-target', socketKey: 'b', side: 'input' as const, socketType: 'number' as const, x: 120, y: 100, canConnect: true },
    { nodeId: 'vector-target', socketKey: 'vector', side: 'input' as const, socketType: 'vector3' as const, x: 101, y: 100, canConnect: true },
    { nodeId: 'number-output', socketKey: 'value', side: 'output' as const, socketType: 'number' as const, x: 101, y: 100, canConnect: true },
  ]

  it('uses the same typed opposite-direction candidates and chooses the nearest one', () => {
    expect(nearestSnapTarget(numberOrigin, candidates, { x: 104, y: 100 })).toMatchObject({ nodeId: 'number-target', socketKey: 'a' })
    expect(nearestSnapTarget(numberOrigin, candidates, { x: 118, y: 100 })).toMatchObject({ nodeId: 'other-number-target', socketKey: 'b' })
  })

  it('does not snap incompatible, same-direction, unavailable, or distant candidates', () => {
    expect(nearestSnapTarget(numberOrigin, candidates.filter((candidate) => candidate.nodeId !== 'number-target' && candidate.nodeId !== 'other-number-target'), { x: 101, y: 100 })).toBeNull()
    expect(nearestSnapTarget(numberOrigin, [{ ...candidates[0]!, canConnect: false }], { x: 100, y: 100 })).toBeNull()
    expect(nearestSnapTarget(numberOrigin, [candidates[0]!], { x: 200, y: 100 })).toBeNull()
  })
})

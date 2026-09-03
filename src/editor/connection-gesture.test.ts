import { describe, expect, it } from 'vitest'

import { compatiblePortKeys, ConnectionGestureManager } from './connection-gesture'

const numberOrigin = { nodeId: 'number', socketKey: 'value', side: 'output' as const, socketType: 'number' as const }

describe('ConnectionGestureManager', () => {
  it('tracks one explicit active gesture and moves its candidate before completion', () => {
    const gesture = new ConnectionGestureManager()
    gesture.begin(numberOrigin)
    expect(gesture.active).toEqual({ origin: numberOrigin, candidateNodeId: null })

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
    expect(gesture.active).toEqual({ origin: numberOrigin, candidateNodeId: null })
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

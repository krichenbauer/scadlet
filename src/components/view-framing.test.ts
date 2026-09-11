import { describe, expect, it } from 'vitest'

import { frameModelBounds } from './view-framing'

describe('frameModelBounds', () => {
  it('centers an off-origin mesh and derives a positive padded camera frame', () => {
    const frame = frameModelBounds({ min: [100, -50, 20], max: [140, 10, 100] }, 50, 16 / 9)

    expect(frame?.target).toEqual([120, -20, 60])
    expect(frame!.distance).toBeGreaterThan(0)
    expect(frame!.near).toBeGreaterThan(0)
    expect(frame!.far).toBeGreaterThan(frame!.distance)
  })

  it('handles unusually small and large bounds without collapsing the clipping range', () => {
    const small = frameModelBounds({ min: [0, 0, 0], max: [0.0001, 0.0002, 0.0003] }, 50, 1)
    const large = frameModelBounds({ min: [-1_000_000, -2_000_000, -3_000_000], max: [1_000_000, 2_000_000, 3_000_000] }, 50, 1)

    expect(small!.distance).toBeGreaterThan(0)
    expect(small!.near).toBeLessThan(small!.far)
    expect(large!.distance).toBeGreaterThan(small!.distance)
    expect(large!.near).toBeLessThan(large!.far)
  })

  it('is a safe no-op policy for no mesh or invalid bounds', () => {
    expect(frameModelBounds(null, 50, 1)).toBeNull()
    expect(frameModelBounds({ min: [1, 0, 0], max: [0, 1, 1] }, 50, 1)).toBeNull()
  })
})

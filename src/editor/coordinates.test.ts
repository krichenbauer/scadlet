import { describe, expect, it } from 'vitest'

import { clientToGraphPosition } from './coordinates'

describe('clientToGraphPosition', () => {
  it('matches the client position at zoom 1 with no pan and a zero-origin container', () => {
    const result = clientToGraphPosition({ x: 100, y: 50 }, { left: 0, top: 0 }, { x: 0, y: 0, k: 1 })
    expect(result).toEqual({ x: 100, y: 50 })
  })

  it('subtracts the container offset (page/layout position) at zoom 1', () => {
    const result = clientToGraphPosition({ x: 120, y: 60 }, { left: 20, top: 10 }, { x: 0, y: 0, k: 1 })
    expect(result).toEqual({ x: 100, y: 50 })
  })

  it('accounts for panning (transform.x/y) at zoom 1', () => {
    const result = clientToGraphPosition({ x: 130, y: 90 }, { left: 0, top: 0 }, { x: 30, y: 40, k: 1 })
    expect(result).toEqual({ x: 100, y: 50 })
  })

  it('accounts for zooming (transform.k)', () => {
    const result = clientToGraphPosition({ x: 200, y: 100 }, { left: 0, top: 0 }, { x: 0, y: 0, k: 2 })
    expect(result).toEqual({ x: 100, y: 50 })
  })

  it('combines container offset, pan, and zoom correctly', () => {
    // graph point (100, 50), panned by (30, 40), zoomed 2x, container offset (20, 10):
    // client = containerOffset + transform + graphPoint * k
    const result = clientToGraphPosition(
      { x: 20 + 30 + 200, y: 10 + 40 + 100 },
      { left: 20, top: 10 },
      { x: 30, y: 40, k: 2 },
    )
    expect(result).toEqual({ x: 100, y: 50 })
  })
})

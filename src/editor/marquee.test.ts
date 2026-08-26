import { describe, expect, it } from 'vitest'

import { normalizeRect, rectsIntersect } from './marquee'

describe('normalizeRect', () => {
  it('normalizes a top-left to bottom-right drag', () => {
    expect(normalizeRect({ x: 10, y: 20 }, { x: 110, y: 70 })).toEqual({
      x: 10,
      y: 20,
      width: 100,
      height: 50,
    })
  })

  it('normalizes a bottom-right to top-left drag', () => {
    expect(normalizeRect({ x: 110, y: 70 }, { x: 10, y: 20 })).toEqual({
      x: 10,
      y: 20,
      width: 100,
      height: 50,
    })
  })

  it('normalizes a mixed-direction drag (top-right to bottom-left)', () => {
    expect(normalizeRect({ x: 110, y: 20 }, { x: 10, y: 70 })).toEqual({
      x: 10,
      y: 20,
      width: 100,
      height: 50,
    })
  })

  it('handles a zero-size drag (no movement yet)', () => {
    expect(normalizeRect({ x: 5, y: 5 }, { x: 5, y: 5 })).toEqual({
      x: 5,
      y: 5,
      width: 0,
      height: 0,
    })
  })
})

describe('rectsIntersect', () => {
  const rect = { x: 0, y: 0, width: 100, height: 100 }

  it('detects a partial overlap', () => {
    expect(rectsIntersect(rect, { x: 50, y: 50, width: 100, height: 100 })).toBe(true)
  })

  it('detects full containment (containment is not required, but must still count)', () => {
    expect(rectsIntersect(rect, { x: 10, y: 10, width: 10, height: 10 })).toBe(true)
  })

  it('detects no overlap', () => {
    expect(rectsIntersect(rect, { x: 200, y: 200, width: 10, height: 10 })).toBe(false)
  })

  it('treats merely touching edges as not intersecting', () => {
    expect(rectsIntersect(rect, { x: 100, y: 0, width: 50, height: 50 })).toBe(false)
  })

  it('is order-independent', () => {
    const other = { x: 50, y: 50, width: 100, height: 100 }
    expect(rectsIntersect(rect, other)).toBe(rectsIntersect(other, rect))
  })
})

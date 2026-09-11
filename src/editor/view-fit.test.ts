import { describe, expect, it } from 'vitest'

import { CANVAS_FIT_ZOOM_RANGE, canvasContentBounds, fitCanvasBounds } from './view-fit'

describe('canvasContentBounds', () => {
  it('encloses varied node dimensions and a visible definition frame', () => {
    const bounds = canvasContentBounds([
      { x: 240, y: -30, width: 180, height: 64 },
      { x: -120, y: 140, width: 220, height: 120 },
      // Definition frames are presentation content too, and can extend past their nodes.
      { x: -162, y: 94, width: 624, height: 220 },
    ])

    expect(bounds).toEqual({ minX: -162, minY: -30, maxX: 462, maxY: 314 })
  })

  it('ignores an unmounted zero-sized item and is safe when no content remains', () => {
    expect(canvasContentBounds([{ x: 0, y: 0, width: 0, height: 0 }])).toBeNull()
    expect(canvasContentBounds([])).toBeNull()
  })
})

describe('fitCanvasBounds', () => {
  it('centers content with the requested padding', () => {
    const transform = fitCanvasBounds(
      { minX: 100, minY: 50, maxX: 500, maxY: 250 },
      { width: 1000, height: 600 },
      50,
    )

    expect(transform).toEqual({ x: -175, y: -37.5, k: 2.25 })
    // 400 × 200 at 2.25 fits within the 900 × 500 usable viewport.
    expect((500 - 100) * transform!.k).toBeLessThanOrEqual(900)
    expect((250 - 50) * transform!.k).toBeLessThanOrEqual(500)
  })

  it('clamps extreme content to the safe fit zoom range', () => {
    const tiny = fitCanvasBounds({ minX: 0, minY: 0, maxX: 1, maxY: 1 }, { width: 800, height: 600 })
    const huge = fitCanvasBounds({ minX: 0, minY: 0, maxX: 100_000, maxY: 50_000 }, { width: 800, height: 600 })

    expect(tiny?.k).toBe(CANVAS_FIT_ZOOM_RANGE.max)
    expect(huge?.k).toBe(CANVAS_FIT_ZOOM_RANGE.min)
  })

  it('does not produce a transform for empty or unusable canvases', () => {
    expect(fitCanvasBounds(null, { width: 800, height: 600 })).toBeNull()
    expect(fitCanvasBounds({ minX: 0, minY: 0, maxX: 10, maxY: 10 }, { width: 40, height: 40 }, 40)).toBeNull()
  })
})

import { describe, expect, it } from 'vitest'

import {
  MAX_UNSUPPORTED_TOUCH_HEIGHT,
  MAX_UNSUPPORTED_TOUCH_WIDTH,
  UNSUPPORTED_SMALL_TOUCH_MEDIA_QUERY,
  isUnsupportedSmallTouchViewport,
} from './small-screen'

describe('small touch viewport policy', () => {
  it.each([
    { width: 390, height: 844, coarsePointer: true },
    { width: 844, height: 390, coarsePointer: true },
    { width: MAX_UNSUPPORTED_TOUCH_WIDTH, height: 900, coarsePointer: true },
    { width: 900, height: MAX_UNSUPPORTED_TOUCH_HEIGHT, coarsePointer: true },
  ])('rejects phone-sized coarse-pointer viewport $width × $height', (viewport) => {
    expect(isUnsupportedSmallTouchViewport(viewport)).toBe(true)
  })

  it.each([
    { width: 768, height: 1024, coarsePointer: true },
    { width: 1024, height: 768, coarsePointer: true },
    { width: 1280, height: 720, coarsePointer: false },
    { width: 390, height: 844, coarsePointer: false },
  ])('keeps usable tablet/desktop viewport $width × $height supported', (viewport) => {
    expect(isUnsupportedSmallTouchViewport(viewport)).toBe(false)
  })

  it('exports the same inclusive boundaries in the browser media query', () => {
    expect(UNSUPPORTED_SMALL_TOUCH_MEDIA_QUERY).toBe(
      `(pointer: coarse) and (max-width: ${MAX_UNSUPPORTED_TOUCH_WIDTH}px), `
      + `(pointer: coarse) and (max-height: ${MAX_UNSUPPORTED_TOUCH_HEIGHT}px)`,
    )
  })
})

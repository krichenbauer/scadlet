/** The existing editor switches to its narrow fallback at 700px. Below that
 * width a coarse-pointer device no longer has enough room for the 200px
 * palette plus the editor's 280px and preview's 240px minimum working widths. */
export const MAX_UNSUPPORTED_TOUCH_WIDTH = 700

/** Short phone-landscape viewports leave too little vertical working room for
 * the header, node canvas, and the viewer/output minimums. */
export const MAX_UNSUPPORTED_TOUCH_HEIGHT = 500

export const UNSUPPORTED_SMALL_TOUCH_MEDIA_QUERY =
  `(pointer: coarse) and (max-width: ${MAX_UNSUPPORTED_TOUCH_WIDTH}px), `
  + `(pointer: coarse) and (max-height: ${MAX_UNSUPPORTED_TOUCH_HEIGHT}px)`

export interface ViewportInput {
  width: number
  height: number
  coarsePointer: boolean
}

/** Pure form of the CSS/media-query policy, kept for boundary-focused tests. */
export function isUnsupportedSmallTouchViewport(viewport: ViewportInput): boolean {
  return viewport.coarsePointer
    && (viewport.width <= MAX_UNSUPPORTED_TOUCH_WIDTH || viewport.height <= MAX_UNSUPPORTED_TOUCH_HEIGHT)
}

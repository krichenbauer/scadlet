/** Bounds in the graph's unscaled coordinate space. */
export interface CanvasBounds {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

export interface CanvasContentItem {
  x: number
  y: number
  width: number
  height: number
}

export interface CanvasViewport {
  width: number
  height: number
}

export interface ZoomRange {
  min: number
  max: number
}

export interface CanvasFitTransform {
  x: number
  y: number
  k: number
}

/** The compact editor remains usable across the wheel-zoom range. */
export const CANVAS_FIT_ZOOM_RANGE: ZoomRange = { min: 0.1, max: 2.5 }
export const CANVAS_FIT_PADDING = 40

/**
 * Combines rendered node rectangles and presentation-only definition frames.
 * Invalid or zero-sized entries are intentionally ignored: a node still being
 * mounted must never turn an otherwise usable recovery action into NaN.
 */
export function canvasContentBounds(items: readonly CanvasContentItem[]): CanvasBounds | null {
  const valid = items.filter((item) =>
    Number.isFinite(item.x) && Number.isFinite(item.y) &&
    Number.isFinite(item.width) && Number.isFinite(item.height) &&
    item.width > 0 && item.height > 0,
  )
  if (valid.length === 0) return null
  return {
    minX: Math.min(...valid.map((item) => item.x)),
    minY: Math.min(...valid.map((item) => item.y)),
    maxX: Math.max(...valid.map((item) => item.x + item.width)),
    maxY: Math.max(...valid.map((item) => item.y + item.height)),
  }
}

/** Returns a centered viewport transform, or null when there is nothing safe to frame. */
export function fitCanvasBounds(
  bounds: CanvasBounds | null,
  viewport: CanvasViewport,
  padding = CANVAS_FIT_PADDING,
  zoomRange: ZoomRange = CANVAS_FIT_ZOOM_RANGE,
): CanvasFitTransform | null {
  if (!bounds || !Number.isFinite(viewport.width) || !Number.isFinite(viewport.height) ||
    viewport.width <= 0 || viewport.height <= 0 || !Number.isFinite(padding) || padding < 0 ||
    !Number.isFinite(zoomRange.min) || !Number.isFinite(zoomRange.max) || zoomRange.min <= 0 || zoomRange.max < zoomRange.min) return null

  const width = bounds.maxX - bounds.minX
  const height = bounds.maxY - bounds.minY
  const usableWidth = viewport.width - padding * 2
  const usableHeight = viewport.height - padding * 2
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0 || usableWidth <= 0 || usableHeight <= 0) return null

  const k = Math.min(zoomRange.max, Math.max(zoomRange.min, Math.min(usableWidth / width, usableHeight / height)))
  const x = viewport.width / 2 - ((bounds.minX + bounds.maxX) / 2) * k
  const y = viewport.height / 2 - ((bounds.minY + bounds.maxY) / 2) * k
  return Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(k) ? { x, y, k } : null
}

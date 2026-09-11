export interface Bounds3 {
  min: readonly [number, number, number]
  max: readonly [number, number, number]
}

export interface CameraFrame {
  target: [number, number, number]
  distance: number
  near: number
  far: number
}

/** A stable three-quarter, Z-up perspective used for every explicit reset. */
export const DEFAULT_VIEW_DIRECTION: readonly [number, number, number] = [1, 1, 0.8]
export const MODEL_FRAME_PADDING = 1.25

export function frameModelBounds(
  bounds: Bounds3 | null,
  verticalFovDegrees: number,
  aspect: number,
  padding = MODEL_FRAME_PADDING,
): CameraFrame | null {
  if (!bounds || !Number.isFinite(verticalFovDegrees) || verticalFovDegrees <= 0 || verticalFovDegrees >= 180 ||
    !Number.isFinite(aspect) || aspect <= 0 || !Number.isFinite(padding) || padding < 1) return null
  const values = [...bounds.min, ...bounds.max]
  if (!values.every(Number.isFinite)) return null
  const size = [bounds.max[0] - bounds.min[0], bounds.max[1] - bounds.min[1], bounds.max[2] - bounds.min[2]]
  if (size.some((value) => value < 0)) return null

  const radius = Math.max(Math.hypot(...size) / 2, 0.01)
  const verticalHalfAngle = verticalFovDegrees * Math.PI / 360
  const horizontalHalfAngle = Math.atan(Math.tan(verticalHalfAngle) * aspect)
  const limitingAngle = Math.min(verticalHalfAngle, horizontalHalfAngle)
  const distance = radius / Math.sin(limitingAngle) * padding
  if (!Number.isFinite(distance) || distance <= 0) return null

  return {
    target: [
      (bounds.min[0] + bounds.max[0]) / 2,
      (bounds.min[1] + bounds.max[1]) / 2,
      (bounds.min[2] + bounds.max[2]) / 2,
    ],
    distance,
    near: Math.max(0.001, distance / 100),
    far: Math.max(distance * 100, distance + radius * 2),
  }
}

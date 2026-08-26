import { formatCall, formatNumber } from './format'

/** OpenSCAD's `sphere()` has two mutually exclusive sizing forms (it has no `center` option - it's always centered at the origin). */
export type SphereSizeMode = 'radius' | 'diameter'

/** Parameters for OpenSCAD's `sphere(r|d, $fn)`. */
export interface SphereParams {
  mode: SphereSizeMode
  r: number
  d: number
  /** `$fn` facet count; `undefined` means "not set" (OpenSCAD's own default applies). */
  fn?: number
}

export const DEFAULT_SPHERE_PARAMS: SphereParams = {
  mode: 'radius',
  r: 5,
  d: 10,
  fn: undefined,
}

/**
 * Renders `sphere()` parameters to an OpenSCAD statement. `mode` selects
 * which of OpenSCAD's two mutually exclusive sizing forms (radius or
 * diameter) is emitted - the same radius/diameter sizing-mode pattern
 * used by `cylinderToOpenSCAD`.
 */
export function sphereToOpenSCAD(params: SphereParams): string {
  const { mode, r, d, fn } = params
  const named: Record<string, string> = mode === 'radius' ? { r: formatNumber(r) } : { d: formatNumber(d) }

  if (fn !== undefined) named.$fn = formatNumber(fn)

  return formatCall('sphere', [], named)
}

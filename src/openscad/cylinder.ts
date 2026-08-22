import { formatCall, formatNumber } from './format'

/** OpenSCAD's `cylinder()` has three mutually exclusive sizing forms. */
export type CylinderSizeMode = 'radius' | 'diameter' | 'tapered'

/** Parameters for OpenSCAD's `cylinder(h, r|d|r1/r2, center, $fn)`. */
export interface CylinderParams {
  h: number
  mode: CylinderSizeMode
  r: number
  d: number
  r1: number
  r2: number
  center: boolean
  /** `$fn` facet count; `undefined` means "not set" (OpenSCAD's own default applies). */
  fn?: number
}

export const DEFAULT_CYLINDER_PARAMS: CylinderParams = {
  h: 10,
  mode: 'radius',
  r: 5,
  d: 10,
  r1: 5,
  r2: 5,
  center: false,
  fn: undefined,
}

/**
 * Renders `cylinder()` parameters to an OpenSCAD statement. `mode` selects
 * which of OpenSCAD's mutually exclusive sizing forms (uniform radius,
 * uniform diameter, or a bottom/top tapered radius pair) is emitted.
 */
export function cylinderToOpenSCAD(params: CylinderParams): string {
  const { h, mode, r, d, r1, r2, center, fn } = params
  const named: Record<string, string> = { h: formatNumber(h) }

  if (mode === 'radius') named.r = formatNumber(r)
  else if (mode === 'diameter') named.d = formatNumber(d)
  else {
    named.r1 = formatNumber(r1)
    named.r2 = formatNumber(r2)
  }

  if (center) named.center = 'true'
  if (fn !== undefined) named.$fn = formatNumber(fn)

  return formatCall('cylinder', [], named)
}

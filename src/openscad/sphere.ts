import { formatCall, formatNumber } from './format'
import { requireFiniteNumber, requireOneOf, requireOptionalFiniteNumber, requireParamsObject } from './param-validation'

/** OpenSCAD's `sphere()` has two mutually exclusive sizing forms (it has no `center` option - it's always centered at the origin). */
export type SphereSizeMode = 'radius' | 'diameter'

const SPHERE_SIZE_MODES: readonly SphereSizeMode[] = ['radius', 'diameter']

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

/** Validates persisted `.scadlet` parameters for a Sphere node, throwing a descriptive `Error` on invalid input. */
export function validateSphereParams(value: unknown): SphereParams {
  const obj = requireParamsObject(value, 'Sphere parameters')
  return {
    mode: requireOneOf(obj.mode, SPHERE_SIZE_MODES, 'Sphere parameter "mode"'),
    r: requireFiniteNumber(obj.r, 'Sphere parameter "r"'),
    d: requireFiniteNumber(obj.d, 'Sphere parameter "d"'),
    fn: requireOptionalFiniteNumber(obj.fn, 'Sphere parameter "fn"'),
  }
}

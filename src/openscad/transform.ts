import { formatBlock, formatVector3 } from './format'
import { requireFiniteNumber, requireParamsObject } from './param-validation'

/** Shared `[x, y, z]` parameter shape for OpenSCAD's translate/rotate/scale transforms. */
export interface Vector3Params {
  x: number
  y: number
  z: number
  /** Active editor/input representation for one semantic OpenSCAD vector. */
  representation?: Vector3Representation
}

export type Vector3Representation = 'xyz' | 'vector'

export const DEFAULT_TRANSLATE_PARAMS: Vector3Params = { x: 0, y: 0, z: 0 }
export const DEFAULT_ROTATE_PARAMS: Vector3Params = { x: 0, y: 0, z: 0 }
export const DEFAULT_SCALE_PARAMS: Vector3Params = { x: 1, y: 1, z: 1 }

export interface TransformResult {
  code: string
  /** Set when the geometry input is missing; `code` is a comment describing why. */
  error?: string
}

/**
 * Shared implementation for OpenSCAD's single-child vector transforms
 * (`translate`/`rotate`/`scale`): all three wrap exactly one already-
 * generated OpenSCAD fragment in `name([x, y, z]) { ... }`. Extracted
 * because `translateToOpenSCAD`/`rotateToOpenSCAD`/`scaleToOpenSCAD`
 * would otherwise be byte-for-byte duplicates of this function, differing
 * only in the OpenSCAD module name.
 */
function vectorTransformToOpenSCAD(
  name: string,
  label: string,
  params: Vector3Params,
  input: string | undefined,
): TransformResult {
  if (!input) {
    const error = `${label} is missing its geometry input`
    return { code: `// ${error}`, error }
  }

  return { code: formatBlock(name, [input], [formatVector3(params.x, params.y, params.z)]) }
}

/** Composes an input fragment into a `translate([x, y, z]) { ... }` block. */
export function translateToOpenSCAD(params: Vector3Params, input: string | undefined): TransformResult {
  return vectorTransformToOpenSCAD('translate', 'Translate', params, input)
}

/** Composes an input fragment into a `rotate([x, y, z]) { ... }` block (simple Euler/vector form only). */
export function rotateToOpenSCAD(params: Vector3Params, input: string | undefined): TransformResult {
  return vectorTransformToOpenSCAD('rotate', 'Rotate', params, input)
}

/** Composes an input fragment into a `scale([x, y, z]) { ... }` block. */
export function scaleToOpenSCAD(params: Vector3Params, input: string | undefined): TransformResult {
  return vectorTransformToOpenSCAD('scale', 'Scale', params, input)
}

/**
 * Validates persisted `.scadlet` parameters shared by Translate/Rotate/
 * Scale, throwing a descriptive `Error` on invalid input. `label` (e.g.
 * `'Translate'`) identifies the node type in the error message.
 */
export function validateVector3Params(value: unknown, label: string): Vector3Params {
  const obj = requireParamsObject(value, `${label} parameters`)
  const result: Vector3Params = {
    x: requireFiniteNumber(obj.x, `${label} parameter "x"`),
    y: requireFiniteNumber(obj.y, `${label} parameter "y"`),
    z: requireFiniteNumber(obj.z, `${label} parameter "z"`),
  }
  if (obj.representation !== undefined) {
    if (obj.representation !== 'xyz' && obj.representation !== 'vector') {
      throw new Error(`Invalid ${label} parameter "representation"`)
    }
    result.representation = obj.representation
  }
  return result
}

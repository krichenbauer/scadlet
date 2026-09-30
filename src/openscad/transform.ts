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

export type Vector3Representation = 'xyz' | 'vector' | 'none'

export const DEFAULT_TRANSLATE_PARAMS: Vector3Params = { x: 0, y: 0, z: 0 }
export const DEFAULT_ROTATE_PARAMS: Vector3Params = { x: 0, y: 0, z: 0 }
export const DEFAULT_SCALE_PARAMS: Vector3Params = { x: 1, y: 1, z: 1 }
/** Mirror and Resize start without arguments, exactly like OpenSCAD's
 * argument-less `mirror()`/`resize()`. The retained X/Y/Z are the values a
 * vector form starts with once added: the YZ plane (left/right mirror) and a
 * visible 10 x 10 x 10 target size. */
export const DEFAULT_MIRROR_PARAMS: Vector3Params = { x: 1, y: 0, z: 0, representation: 'none' }
export const DEFAULT_RESIZE_PARAMS: Vector3Params = { x: 10, y: 10, z: 10, representation: 'none' }

/** Resize additionally carries OpenSCAD's optional `auto` flag ("Keep
 * proportions"): with it, axes set to 0 scale proportionally. Omitted means
 * the argument is absent. */
export interface ResizeParams extends Vector3Params {
  auto?: boolean
}

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

/** Composes an input fragment into a `mirror([x, y, z]) { ... }` block; the vector is the mirror plane's normal. */
export function mirrorToOpenSCAD(params: Vector3Params, input: string | undefined): TransformResult {
  return vectorTransformToOpenSCAD('mirror', 'Mirror', params, input)
}

/** Composes an input fragment into a `resize([x, y, z]) { ... }` block; an axis of 0 keeps its size. */
export function resizeToOpenSCAD(params: Vector3Params, input: string | undefined): TransformResult {
  return vectorTransformToOpenSCAD('resize', 'Resize', params, input)
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
    if (obj.representation !== 'xyz' && obj.representation !== 'vector' && obj.representation !== 'none') {
      throw new Error(`Invalid ${label} parameter "representation"`)
    }
    result.representation = obj.representation
  }
  return result
}

/** Validates persisted Resize parameters: the shared vector fields plus the
 * optional Boolean `auto`. */
export function validateResizeParams(value: unknown): ResizeParams {
  const result: ResizeParams = validateVector3Params(value, 'Resize')
  const auto = (value as Record<string, unknown>).auto
  if (auto !== undefined) {
    if (typeof auto !== 'boolean') throw new Error('Invalid Resize parameter "auto": expected a boolean')
    result.auto = auto
  }
  return result
}

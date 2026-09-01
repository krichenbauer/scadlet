import { formatCall, formatNumber, formatVector3 } from './format'
import { requireBoolean, requireFiniteNumber, requireParamsObject } from './param-validation'

/** Parameters for OpenSCAD's `cube(size, center)`. */
export interface CubeParams {
  size?: number | Vector3Params
  center?: boolean
  /** The active v2 editor/input representation for the single semantic
   * OpenSCAD `size` argument. Absent in early v2 files and inferred from
   * `size` during validation. */
  sizeRepresentation?: CubeSizeRepresentation
  /** Stored independently so switching Scalar → XYZ → Scalar restores the
   * prior literal instead of deriving a new one from the other editor. */
  sizeScalar?: number
  sizeVector?: Vector3Params
  /** @deprecated v1 compatibility; v2 stores one semantic `size`. */
  sizeX?: number
  /** @deprecated v1 compatibility; v2 stores one semantic `size`. */
  sizeY?: number
  /** @deprecated v1 compatibility; v2 stores one semantic `size`. */
  sizeZ?: number
}

export type CubeSizeRepresentation = 'scalar' | 'xyz' | 'vector'

export interface Vector3Params { x: number; y: number; z: number }

/** Matches OpenSCAD's own `center` default; `10` is a more visible starting size than OpenSCAD's `1`. */
export const DEFAULT_CUBE_PARAMS: CubeParams = {
  size: 10,
}

/**
 * Renders `cube()` parameters to an OpenSCAD statement, using the compact
 * scalar `size` form when all three dimensions are equal and the vector
 * form otherwise.
 */
export function cubeToOpenSCAD(params: CubeParams): string {
  const legacy = params.sizeX === undefined ? undefined : params.sizeX === params.sizeY && params.sizeY === params.sizeZ ? params.sizeX : { x: params.sizeX, y: params.sizeY ?? params.sizeX, z: params.sizeZ ?? params.sizeX }
  const effectiveSize = params.size ?? legacy
  const size = effectiveSize === undefined
    ? undefined
    : typeof effectiveSize === 'number'
      ? formatNumber(effectiveSize)
      : formatVector3(effectiveSize.x, effectiveSize.y, effectiveSize.z)
  return formatCall('cube', size === undefined ? [] : [size], params.center ? { center: 'true' } : {})
}

/** Validates persisted `.scadlet` parameters for a Cube node, throwing a descriptive `Error` on invalid input. */
export function validateCubeParams(value: unknown): CubeParams {
  const obj = requireParamsObject(value, 'Cube parameters')
  if (obj.sizeX !== undefined || obj.sizeY !== undefined || obj.sizeZ !== undefined) {
    return {
      sizeX: requireFiniteNumber(obj.sizeX, 'Cube parameter "sizeX"'),
      sizeY: requireFiniteNumber(obj.sizeY, 'Cube parameter "sizeY"'),
      sizeZ: requireFiniteNumber(obj.sizeZ, 'Cube parameter "sizeZ"'),
      center: requireBoolean(obj.center, 'Cube parameter "center"'),
    }
  }
  const params: CubeParams = {}
  if (obj.size !== undefined) {
    if (typeof obj.size === 'number') params.size = requireFiniteNumber(obj.size, 'Cube parameter "size"')
    else {
      const size = requireParamsObject(obj.size, 'Cube parameter "size"')
      params.size = {
        x: requireFiniteNumber(size.x, 'Cube parameter "size.x"'),
        y: requireFiniteNumber(size.y, 'Cube parameter "size.y"'),
        z: requireFiniteNumber(size.z, 'Cube parameter "size.z"'),
      }
    }
  }
  if (obj.center !== undefined) params.center = requireBoolean(obj.center, 'Cube parameter "center"')
  if (obj.sizeRepresentation !== undefined) {
    if (obj.sizeRepresentation !== 'scalar' && obj.sizeRepresentation !== 'xyz' && obj.sizeRepresentation !== 'vector') {
      throw new Error('Invalid Cube parameter "sizeRepresentation"')
    }
    params.sizeRepresentation = obj.sizeRepresentation
  }
  if (obj.sizeScalar !== undefined) params.sizeScalar = requireFiniteNumber(obj.sizeScalar, 'Cube parameter "sizeScalar"')
  if (obj.sizeVector !== undefined) {
    const vector = requireParamsObject(obj.sizeVector, 'Cube parameter "sizeVector"')
    params.sizeVector = {
      x: requireFiniteNumber(vector.x, 'Cube parameter "sizeVector.x"'),
      y: requireFiniteNumber(vector.y, 'Cube parameter "sizeVector.y"'),
      z: requireFiniteNumber(vector.z, 'Cube parameter "sizeVector.z"'),
    }
  }
  if (params.sizeRepresentation === undefined && params.size !== undefined) {
    params.sizeRepresentation = typeof params.size === 'number' ? 'scalar' : 'xyz'
  }
  return params
}

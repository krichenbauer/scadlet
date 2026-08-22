import { formatCall, formatNumber, formatVector3 } from './format'

/** Parameters for OpenSCAD's `cube(size, center)`. */
export interface CubeParams {
  sizeX: number
  sizeY: number
  sizeZ: number
  center: boolean
}

/** Matches OpenSCAD's own `center` default; `10` is a more visible starting size than OpenSCAD's `1`. */
export const DEFAULT_CUBE_PARAMS: CubeParams = {
  sizeX: 10,
  sizeY: 10,
  sizeZ: 10,
  center: false,
}

/**
 * Renders `cube()` parameters to an OpenSCAD statement, using the compact
 * scalar `size` form when all three dimensions are equal and the vector
 * form otherwise.
 */
export function cubeToOpenSCAD(params: CubeParams): string {
  const { sizeX, sizeY, sizeZ, center } = params
  const isUniform = sizeX === sizeY && sizeY === sizeZ
  const size = isUniform ? formatNumber(sizeX) : formatVector3(sizeX, sizeY, sizeZ)

  return formatCall('cube', [size], center ? { center: 'true' } : {})
}

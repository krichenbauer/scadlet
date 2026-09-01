import { DEFAULT_ROTATE_PARAMS, rotateToOpenSCAD, type Vector3Params } from '../../openscad/transform'
import { VectorTransformNode } from './vector-transform-node'

/**
 * The `rotate([x, y, z]) { ... }` transform (simple Euler/vector form
 * only - OpenSCAD's alternate `rotate(a=..., v=[...])` axis-angle form is
 * out of scope for this milestone). See `VectorTransformNode` for the
 * shared node shape.
 */
export class RotateNode extends VectorTransformNode {
  constructor(params: Partial<Vector3Params> = {}, notify?: () => void, canSwitch?: () => boolean) {
    super('Rotate', { ...DEFAULT_ROTATE_PARAMS, ...params }, rotateToOpenSCAD, notify, canSwitch)
  }
}

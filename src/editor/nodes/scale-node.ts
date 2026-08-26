import { DEFAULT_SCALE_PARAMS, scaleToOpenSCAD, type Vector3Params } from '../../openscad/transform'
import { VectorTransformNode } from './vector-transform-node'

/** The `scale([x, y, z]) { ... }` transform. See `VectorTransformNode` for the shared node shape. */
export class ScaleNode extends VectorTransformNode {
  constructor(params: Partial<Vector3Params> = {}) {
    super('Scale', { ...DEFAULT_SCALE_PARAMS, ...params }, scaleToOpenSCAD)
  }
}

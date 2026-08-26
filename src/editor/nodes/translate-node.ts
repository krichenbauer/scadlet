import { DEFAULT_TRANSLATE_PARAMS, translateToOpenSCAD, type Vector3Params } from '../../openscad/transform'
import { VectorTransformNode } from './vector-transform-node'

/** The `translate([x, y, z]) { ... }` transform. See `VectorTransformNode` for the shared node shape. */
export class TranslateNode extends VectorTransformNode {
  constructor(params: Partial<Vector3Params> = {}) {
    super('Translate', { ...DEFAULT_TRANSLATE_PARAMS, ...params }, translateToOpenSCAD)
  }
}

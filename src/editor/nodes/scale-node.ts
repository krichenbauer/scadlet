import { DEFAULT_SCALE_PARAMS, scaleToOpenSCAD, type Vector3Params } from '../../openscad/transform'
import { t } from '../../i18n/translate'
import { VectorTransformNode } from './vector-transform-node'

/** The `scale([x, y, z]) { ... }` transform. See `VectorTransformNode` for the shared node shape. */
export class ScaleNode extends VectorTransformNode {
  constructor(params: Partial<Vector3Params> = {}, notify?: () => void, canSwitch?: () => boolean) {
    super(t('node.scale'), { ...DEFAULT_SCALE_PARAMS, ...params }, scaleToOpenSCAD, notify, canSwitch)
  }
}

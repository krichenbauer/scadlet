import { DEFAULT_TRANSLATE_PARAMS, translateToOpenSCAD, type Vector3Params } from '../../openscad/transform'
import { t } from '../../i18n/translate'
import { VectorTransformNode } from './vector-transform-node'

/** The `translate([x, y, z]) { ... }` transform. See `VectorTransformNode` for the shared node shape. */
export class TranslateNode extends VectorTransformNode {
  constructor(params: Partial<Vector3Params> = {}, notify?: () => void, canSwitch?: () => boolean) {
    super(t('node.translate'), { ...DEFAULT_TRANSLATE_PARAMS, ...params }, translateToOpenSCAD, notify, canSwitch)
  }
}

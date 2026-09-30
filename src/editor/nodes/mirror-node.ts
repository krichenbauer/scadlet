import { DEFAULT_MIRROR_PARAMS, mirrorToOpenSCAD, type Vector3Params } from '../../openscad/transform'
import { t } from '../../i18n/translate'
import { VectorTransformNode } from './vector-transform-node'

/**
 * The `mirror([x, y, z]) { ... }` transform: reflects geometry across the
 * plane through the origin whose normal is the vector. A new node starts
 * without a vector, emitting OpenSCAD's own argument-less `mirror()` (which
 * OpenSCAD treats as the YZ plane); an added vector starts at X = 1.
 */
export class MirrorNode extends VectorTransformNode {
  constructor(params: Partial<Vector3Params> = {}, notify?: () => void, requestRemoveForm?: (keys: readonly string[], label: string) => Promise<boolean>) {
    super(t('node.mirror'), 'mirror', { ...DEFAULT_MIRROR_PARAMS, ...params }, mirrorToOpenSCAD, notify, requestRemoveForm)
  }
}

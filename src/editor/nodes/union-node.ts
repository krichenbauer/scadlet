import { t } from '../../i18n/translate'
import { unionToOpenSCAD } from '../../openscad/csg'
import { BooleanOpNode } from './boolean-op-node'

/** Composes two connected geometry inputs into a `union() { ... }` block. */
export class UnionNode extends BooleanOpNode {
  constructor() {
    super('Union', { a: t('input.a'), b: t('input.b') }, unionToOpenSCAD)
  }
}

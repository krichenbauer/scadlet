import { t } from '../../i18n/translate'
import { intersectionToOpenSCAD } from '../../openscad/csg'
import { BooleanOpNode } from './boolean-op-node'

/** Composes two connected geometry inputs into an `intersection() { ... }` block. */
export class IntersectionNode extends BooleanOpNode {
  constructor() {
    super('Intersection', { a: t('input.a'), b: t('input.b') }, intersectionToOpenSCAD)
  }
}

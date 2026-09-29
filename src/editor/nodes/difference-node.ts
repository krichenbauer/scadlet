import { BooleanOpNode, type VariadicBooleanParams } from './boolean-op-node'
import { t } from '../../i18n/translate'

/** Ordered Geometry composition. The first two ports keep their historical
 * stable ids; further subtractors use stable child ids. */
export class DifferenceNode extends BooleanOpNode {
  constructor(params: Partial<VariadicBooleanParams> = {}) {
    super(t('node.difference'), 'difference', params)
  }
}

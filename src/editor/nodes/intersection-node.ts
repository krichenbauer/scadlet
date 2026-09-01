import { BooleanOpNode, type VariadicBooleanParams } from './boolean-op-node'
import { t } from '../../i18n/translate'
export class IntersectionNode extends BooleanOpNode { constructor(params: Partial<VariadicBooleanParams> = {}, legacy = true) { super(t('node.intersection'), 'intersection', params, legacy) } }

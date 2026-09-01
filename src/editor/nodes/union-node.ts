import { BooleanOpNode, type VariadicBooleanParams } from './boolean-op-node'
import { t } from '../../i18n/translate'
export class UnionNode extends BooleanOpNode { constructor(params: Partial<VariadicBooleanParams> = {}, legacy = true) { super(t('node.union'), 'union', params, legacy) } }

import { BooleanOpNode, type VariadicBooleanParams } from './boolean-op-node'
export class UnionNode extends BooleanOpNode { constructor(params: Partial<VariadicBooleanParams> = {}, legacy = true) { super('Union', 'union', params, legacy) } }

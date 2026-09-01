import { BooleanOpNode, type VariadicBooleanParams } from './boolean-op-node'
export class IntersectionNode extends BooleanOpNode { constructor(params: Partial<VariadicBooleanParams> = {}, legacy = true) { super('Intersection', 'intersection', params, legacy) } }

import { ClassicPreset } from 'rete'
import type { DataflowNode } from 'rete-engine'

import { t } from '../../i18n/translate'
import { CheckboxControl, LabeledNumberControl, LabeledTextControl, OptionalNumberControl, TitleSelectControl } from '../controls'
import { booleanSocket, numberSocket, unresolvedSocket, vector3Socket, type BooleanValue, type NumberValue, type Vector3Value } from '../sockets'

export interface NumberParams { value: number; name?: string; bindingId?: string }
export interface BooleanParams { value: boolean; name?: string; bindingId?: string }
export interface Vector3ValueParams { x: number; y: number; z: number; name?: string; bindingId?: string }
export type ArithmeticOperation = 'addition' | 'subtraction' | 'multiplication' | 'division' | 'modulo' | 'power'
export interface ArithmeticParams { operation: ArithmeticOperation; a: number; b: number }
export type TrigonometryOperation = 'sin' | 'cos' | 'tan' | 'asin' | 'acos' | 'atan' | 'atan2'
export type TrigonometryInputPort = 'a' | 'b'
export interface TrigonometryParams { operation: TrigonometryOperation; a: number; b: number; inputPorts: TrigonometryInputPort[] }
export type BasicMathOperation = 'abs' | 'sign' | 'sqrt' | 'floor' | 'ceil' | 'round' | 'negate'
export interface BasicMathParams { operation: BasicMathOperation; x: number }
export type ExponentialLogOperation = 'exp' | 'ln' | 'log'
export interface ExponentialLogParams { operation: ExponentialLogOperation; x: number }
export type CompareOperator = '<' | '<=' | '>' | '>=' | '==' | '!='
export interface CompareParams { operator: CompareOperator; a: number; b: number }
type CompareControls = { operator: TitleSelectControl<CompareOperator>; a: LabeledNumberControl; b: LabeledNumberControl }
export type ConditionalValueType = 'number' | 'boolean' | 'vector3'
export interface ConditionalParams { valueType?: ConditionalValueType }

function finiteNumber(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`Invalid parameters: "${name}" must be a finite number`)
  return value
}

function object(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Invalid parameters: expected an object')
  return value as Record<string, unknown>
}

function optionalBindingId(value: unknown): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string' || value.length === 0) throw new Error('Invalid parameters: "bindingId" must be a non-empty string')
  return value
}

export function validateNumberParams(value: unknown): NumberParams {
  const params = object(value)
  return { value: finiteNumber(params.value, 'value'), name: typeof params.name === 'string' ? params.name : 'Number', ...(optionalBindingId(params.bindingId) ? { bindingId: params.bindingId as string } : {}) }
}

export function validateBooleanParams(value: unknown): BooleanParams {
  const params = object(value)
  if (typeof params.value !== 'boolean') throw new Error('Invalid parameters: "value" must be a boolean')
  return { value: params.value, name: typeof params.name === 'string' ? params.name : 'Boolean', ...(optionalBindingId(params.bindingId) ? { bindingId: params.bindingId as string } : {}) }
}

export function validateVector3ValueParams(value: unknown): Vector3ValueParams {
  const params = object(value)
  return { x: finiteNumber(params.x, 'x'), y: finiteNumber(params.y, 'y'), z: finiteNumber(params.z, 'z'), name: typeof params.name === 'string' ? params.name : 'Vector3', ...(optionalBindingId(params.bindingId) ? { bindingId: params.bindingId as string } : {}) }
}

function exactOperation<T extends string>(value: unknown, operations: readonly T[], family: string): T {
  if (typeof value !== 'string' || !operations.includes(value as T)) {
    throw new Error(`Invalid parameters: "operation" must be a supported ${family} operation`)
  }
  return value as T
}

export const ARITHMETIC_OPERATIONS = ['addition', 'subtraction', 'multiplication', 'division', 'modulo', 'power'] as const
export const TRIGONOMETRY_OPERATIONS = ['sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'atan2'] as const
export const BASIC_MATH_OPERATIONS = ['abs', 'sign', 'sqrt', 'floor', 'ceil', 'round', 'negate'] as const
export const EXPONENTIAL_LOG_OPERATIONS = ['exp', 'ln', 'log'] as const

export function validateArithmeticParams(value: unknown): ArithmeticParams {
  const params = object(value)
  return {
    operation: exactOperation(params.operation, ARITHMETIC_OPERATIONS, 'Arithmetic'),
    a: finiteNumber(params.a, 'a'),
    b: finiteNumber(params.b, 'b'),
  }
}

export function validateTrigonometryParams(value: unknown): TrigonometryParams {
  const params = object(value)
  const operation = exactOperation(params.operation, TRIGONOMETRY_OPERATIONS, 'Trigonometry')
  if (!Array.isArray(params.inputPorts) || params.inputPorts.some((port) => port !== 'a' && port !== 'b')) {
    throw new Error('Invalid parameters: "inputPorts" must contain canonical Trigonometry port ids')
  }
  const inputPorts = params.inputPorts as TrigonometryInputPort[]
  if (new Set(inputPorts).size !== inputPorts.length) {
    throw new Error('Invalid parameters: duplicate Trigonometry input ports')
  }
  const expected = operation === 'atan2' ? ['a', 'b'] : ['a']
  if (inputPorts.length !== expected.length || expected.some((port, index) => inputPorts[index] !== port)) {
    throw new Error(`Invalid parameters: ${operation} requires inputPorts [${expected.join(', ')}]`)
  }
  return {
    operation,
    a: finiteNumber(params.a, 'a'),
    b: finiteNumber(params.b, 'b'),
    inputPorts: [...expected] as TrigonometryInputPort[],
  }
}

export function validateBasicMathParams(value: unknown): BasicMathParams {
  const params = object(value)
  return { operation: exactOperation(params.operation, BASIC_MATH_OPERATIONS, 'Basic Math'), x: finiteNumber(params.x, 'x') }
}

export function validateExponentialLogParams(value: unknown): ExponentialLogParams {
  const params = object(value)
  return { operation: exactOperation(params.operation, EXPONENTIAL_LOG_OPERATIONS, 'Exponential / Logarithmic'), x: finiteNumber(params.x, 'x') }
}

export function validateCompareParams(value: unknown): CompareParams {
  const params = object(value)
  if (params.operator !== '<' && params.operator !== '<=' && params.operator !== '>' && params.operator !== '>=' && params.operator !== '==' && params.operator !== '!=') {
    throw new Error('Invalid parameters: "operator" must be a supported comparison operator')
  }
  // Compare gained inline Number fallbacks after v6 had already shipped.
  // Missing fields therefore mean the established Number fallback defaults,
  // allowing older v6 Compare records to restore without a format migration.
  return { operator: params.operator, a: params.a === undefined ? 0 : finiteNumber(params.a, 'a'), b: params.b === undefined ? 0 : finiteNumber(params.b, 'b') }
}

export function validateConditionalParams(value: unknown): ConditionalParams {
  const params = object(value)
  if (params.valueType === undefined) return {}
  if (params.valueType !== 'number' && params.valueType !== 'boolean' && params.valueType !== 'vector3') {
    throw new Error('Invalid parameters: "valueType" must be number, boolean, vector3, or omitted')
  }
  return { valueType: params.valueType }
}

function socketForConditionalType(type: ConditionalValueType | undefined) {
  return type === 'number' ? numberSocket : type === 'boolean' ? booleanSocket : type === 'vector3' ? vector3Socket : unresolvedSocket
}

/** A literal Number is an OpenSCAD expression source, never a JavaScript calculation. */
export class NumberNode extends ClassicPreset.Node<{ value: ClassicPreset.Socket }, { value: ClassicPreset.Socket }, { name: LabeledTextControl; value: LabeledNumberControl }> implements DataflowNode {
  private bindingId?: string
  constructor(params: NumberParams = { value: 10, name: 'Number' }) {
    super(t('node.number'))
    this.bindingId = params.bindingId
    this.addControl('name', new LabeledTextControl(t('control.name'), { initial: params.name ?? 'Number' }))
    this.addInput('value', new ClassicPreset.Input(numberSocket, t('input.value')))
    this.addControl('value', new LabeledNumberControl(t('control.value'), { initial: params.value }))
    this.addOutput('value', new ClassicPreset.Output(numberSocket, t('output.number')))
  }

  getBindingId(): string | undefined { return this.bindingId }
  getBindingName(): string { return this.controls.name.value ?? '' }
  renameBinding(name: string): void { this.bindingId ??= this.id; this.controls.name.setValue(name) }
  getPersistedParams(): NumberParams { return { value: this.controls.value.value ?? 0, name: this.getBindingName(), ...(this.bindingId ? { bindingId: this.bindingId } : {}) } }
  data(inputs: { value?: NumberValue[] } = {}): { value: NumberValue } {
    return { value: inputs.value?.[0] ?? { code: String(this.controls.value.value ?? 0) } }
  }
}

export class BooleanNode extends ClassicPreset.Node<{ value: ClassicPreset.Socket }, { value: ClassicPreset.Socket }, { name: LabeledTextControl; value: CheckboxControl }> implements DataflowNode {
  private bindingId?: string
  constructor(params: BooleanParams = { value: false, name: 'Boolean' }) {
    super(t('node.boolean'))
    this.bindingId = params.bindingId
    this.addControl('name', new LabeledTextControl(t('control.name'), { initial: params.name ?? 'Boolean' }))
    this.addInput('value', new ClassicPreset.Input(booleanSocket, t('input.value')))
    this.addControl('value', new CheckboxControl(t('control.value'), params.value))
    this.addOutput('value', new ClassicPreset.Output(booleanSocket, t('output.boolean')))
  }

  getBindingId(): string | undefined { return this.bindingId }
  getBindingName(): string { return this.controls.name.value ?? '' }
  renameBinding(name: string): void { this.bindingId ??= this.id; this.controls.name.setValue(name) }
  getPersistedParams(): BooleanParams { return { value: this.controls.value.value, name: this.getBindingName(), ...(this.bindingId ? { bindingId: this.bindingId } : {}) } }
  data(inputs: { value?: BooleanValue[] } = {}): { value: BooleanValue } {
    return { value: inputs.value?.[0] ?? { code: this.controls.value.value ? 'true' : 'false' } }
  }
}

export class Vector3Node extends ClassicPreset.Node<Record<string, ClassicPreset.Socket>, { value: ClassicPreset.Socket }, Record<string, LabeledNumberControl | LabeledTextControl>> implements DataflowNode {
  private bindingId?: string
  constructor(params: Vector3ValueParams = { x: 0, y: 0, z: 0, name: 'Vector3' }) {
    super(t('node.vector3'))
    this.bindingId = params.bindingId
    this.addControl('name', new LabeledTextControl(t('control.name'), { initial: params.name ?? 'Vector3' }))
    this.addInput('value', new ClassicPreset.Input(vector3Socket, t('input.value')))
    for (const [key, label] of [['x', t('control.x')], ['y', t('control.y')], ['z', t('control.z')]] as const) {
      this.addInput(key, new ClassicPreset.Input(numberSocket, label))
      this.addControl(key, new LabeledNumberControl(label, { initial: params[key] }))
    }
    this.addOutput('value', new ClassicPreset.Output(vector3Socket, t('output.vector3')))
  }

  getPersistedParams(): Vector3ValueParams {
    return { x: (this.controls.x as LabeledNumberControl).value ?? 0, y: (this.controls.y as LabeledNumberControl).value ?? 0, z: (this.controls.z as LabeledNumberControl).value ?? 0, name: this.getBindingName(), ...(this.bindingId ? { bindingId: this.bindingId } : {}) }
  }

  getBindingId(): string | undefined { return this.bindingId }
  getBindingName(): string { return (this.controls.name as LabeledTextControl).value ?? '' }
  renameBinding(name: string): void { this.bindingId ??= this.id; (this.controls.name as LabeledTextControl).setValue(name) }

  data(inputs: Record<string, (NumberValue | Vector3Value)[] | undefined>): { value: Vector3Value } {
    const connected = inputs.value?.[0]
    if (connected) return { value: connected }
    const params = this.getPersistedParams()
    const x = inputs.x?.[0]?.code ?? String(params.x)
    const y = inputs.y?.[0]?.code ?? String(params.y)
    const z = inputs.z?.[0]?.code ?? String(params.z)
    return { value: { code: `[${x}, ${y}, ${z}]` } }
  }
}

const arithmeticOptions = [
  { value: 'addition', label: '+' }, { value: 'subtraction', label: '−' },
  { value: 'multiplication', label: '×' }, { value: 'division', label: '÷' },
  { value: 'modulo', label: '%' }, { value: 'power', label: 'pow' },
] as const

export class ArithmeticNode extends ClassicPreset.Node<Record<string, ClassicPreset.Socket>, { value: ClassicPreset.Socket }, Record<string, LabeledNumberControl | TitleSelectControl<ArithmeticOperation>>> implements DataflowNode {
  constructor(params: ArithmeticParams = { operation: 'addition', a: 0, b: 0 }) {
    super(t('node.arithmetic'))
    this.addControl('operation', new TitleSelectControl(t('node.arithmeticOperation'), arithmeticOptions, params.operation))
    for (const [key, value, labelText] of [['a', params.a, t('input.a')], ['b', params.b, t('input.b')]] as const) {
      this.addInput(key, new ClassicPreset.Input(numberSocket, labelText))
      this.addControl(key, new LabeledNumberControl(labelText, { initial: value }))
    }
    this.addOutput('value', new ClassicPreset.Output(numberSocket, t('output.number')))
  }

  getPersistedParams(): ArithmeticParams {
    return { operation: (this.controls.operation as TitleSelectControl<ArithmeticOperation>).value, a: (this.controls.a as LabeledNumberControl).value ?? 0, b: (this.controls.b as LabeledNumberControl).value ?? 0 }
  }
  data(inputs: Record<string, NumberValue[] | undefined>): { value: NumberValue } {
    const params = this.getPersistedParams()
    const a = inputs.a?.[0]?.code ?? String(params.a)
    const b = inputs.b?.[0]?.code ?? String(params.b)
    const operators: Record<Exclude<ArithmeticOperation, 'power'>, string> = { addition: '+', subtraction: '-', multiplication: '*', division: '/', modulo: '%' }
    return { value: { code: params.operation === 'power' ? `pow(${a}, ${b})` : `(${a} ${operators[params.operation]} ${b})` } }
  }
}

const trigonometryOptions = TRIGONOMETRY_OPERATIONS.map((value) => ({ value, label: value }))

export class TrigonometryNode extends ClassicPreset.Node<Record<string, ClassicPreset.Socket>, { value: ClassicPreset.Socket }, Record<string, LabeledNumberControl | TitleSelectControl<TrigonometryOperation>>> implements DataflowNode {
  private secondaryFallback: number

  constructor(params: TrigonometryParams = { operation: 'sin', a: 0, b: 0, inputPorts: ['a'] }) {
    super(t('node.trigonometry'))
    this.secondaryFallback = params.b
    this.addControl('operation', new TitleSelectControl(t('node.trigonometryOperation'), trigonometryOptions, params.operation))
    this.addPrimaryInput(params.operation, params.a)
    if (params.operation === 'atan2') this.addSecondaryInput(params.b)
    this.addOutput('value', new ClassicPreset.Output(numberSocket, t('output.number')))
  }

  private addPrimaryInput(operation: TrigonometryOperation, value: number): void {
    const label = operation === 'atan2' ? t('input.y') : t('input.x')
    this.addInput('a', new ClassicPreset.Input(numberSocket, label))
    this.addControl('a', new LabeledNumberControl(label, { initial: value }))
  }

  private addSecondaryInput(value: number): void {
    this.addInput('b', new ClassicPreset.Input(numberSocket, t('input.x')))
    this.addControl('b', new LabeledNumberControl(t('input.x'), { initial: value }))
  }

  /** Commits a preflighted operation transition. The editor removes any
   * affected `b` wire first; direct callers are protected by Rete's port
   * removal guard when the node belongs to the live editor. */
  setOperation(operation: TrigonometryOperation, secondaryFallback?: number): void {
    const control = this.controls.operation as TitleSelectControl<TrigonometryOperation>
    if (operation === control.value) return
    const previous = this.getPersistedParams()
    this.secondaryFallback = previous.b
    if (operation === 'atan2') {
      if (!this.inputs.b) this.addSecondaryInput(secondaryFallback ?? previous.b)
    } else if (this.inputs.b) {
      this.removeInput('b')
      this.removeControl('b')
    }
    const primary = this.inputs.a
    const primaryControl = this.controls.a as LabeledNumberControl
    const label = operation === 'atan2' ? t('input.y') : t('input.x')
    if (primary) primary.label = label
    primaryControl.label = label
    control.value = operation
  }

  getPersistedParams(): TrigonometryParams {
    return {
      operation: (this.controls.operation as TitleSelectControl<TrigonometryOperation>).value,
      a: (this.controls.a as LabeledNumberControl).value ?? 0,
      b: (this.controls.b as LabeledNumberControl | undefined)?.value ?? this.secondaryFallback,
      inputPorts: this.inputs.b ? ['a', 'b'] : ['a'],
    }
  }

  data(inputs: Record<string, NumberValue[] | undefined>): { value: NumberValue } {
    const params = this.getPersistedParams()
    const a = inputs.a?.[0]?.code ?? String(params.a)
    const b = inputs.b?.[0]?.code ?? String(params.b)
    return { value: { code: params.operation === 'atan2' ? `atan2(${a}, ${b})` : `${params.operation}(${a})` } }
  }
}

abstract class UnaryMathNode<Operation extends string, Params extends { operation: Operation; x: number }> extends ClassicPreset.Node<Record<string, ClassicPreset.Socket>, { value: ClassicPreset.Socket }, Record<string, LabeledNumberControl | TitleSelectControl<Operation>>> implements DataflowNode {
  constructor(label: string, accessibleLabel: string, options: readonly { value: Operation; label: string }[], params: Params) {
    super(label)
    this.addControl('operation', new TitleSelectControl(accessibleLabel, options, params.operation))
    this.addInput('x', new ClassicPreset.Input(numberSocket, t('input.x')))
    this.addControl('x', new LabeledNumberControl(t('input.x'), { initial: params.x }))
    this.addOutput('value', new ClassicPreset.Output(numberSocket, t('output.number')))
  }
  protected persisted(): Params { return { operation: (this.controls.operation as TitleSelectControl<Operation>).value, x: (this.controls.x as LabeledNumberControl).value ?? 0 } as Params }
  data(inputs: Record<string, NumberValue[] | undefined>): { value: NumberValue } {
    const params = this.persisted()
    const x = inputs.x?.[0]?.code ?? String(params.x)
    return { value: { code: params.operation === 'negate' ? `-(${x})` : `${params.operation}(${x})` } }
  }
}

export type VectorMathOperation = 'add' | 'subtract' | 'scale' | 'divide' | 'dot' | 'cross' | 'norm' | 'negate'
export interface VectorMathParams { operation: VectorMathOperation; a: number; b: number; factor: number }
export const VECTOR_MATH_OPERATIONS = ['add', 'subtract', 'scale', 'divide', 'dot', 'cross', 'norm', 'negate'] as const
export function validateVectorMathParams(value: unknown): VectorMathParams {
  const params = object(value)
  return { operation: exactOperation(params.operation, VECTOR_MATH_OPERATIONS, 'Vector Math'), a: finiteNumber(params.a, 'a'), b: finiteNumber(params.b, 'b'), factor: finiteNumber(params.factor, 'factor') }
}

const vectorMathOptions = [
  { value: 'add', label: t('math.vectorAdd') }, { value: 'subtract', label: t('math.vectorSubtract') }, { value: 'scale', label: t('math.vectorScale') },
  { value: 'divide', label: t('math.vectorDivide') }, { value: 'dot', label: t('math.vectorDot') }, { value: 'cross', label: t('math.vectorCross') },
  { value: 'norm', label: t('math.vectorNorm') }, { value: 'negate', label: t('math.vectorNegate') },
] as const

/** Typed Vector3 operations use stable semantic port keys across the complete
 * signature. Inactive ports remain in the model, so changing operations never
 * leaves a live wire attached to a stale socket. */
export class VectorMathNode extends ClassicPreset.Node<Record<string, ClassicPreset.Socket>, { value: ClassicPreset.Socket }, Record<string, LabeledNumberControl | TitleSelectControl<VectorMathOperation>>> implements DataflowNode {
  private scalarFallback: number
  constructor(params: VectorMathParams = { operation: 'add', a: 0, b: 0, factor: 1 }) {
    super(t('node.vectorMath'))
    this.scalarFallback = params.factor
    this.addControl('operation', new TitleSelectControl(t('node.vectorMathOperation'), vectorMathOptions, params.operation))
    this.installInputs(params.operation, params)
    this.addOutput('value', new ClassicPreset.Output(this.outputType(params.operation), t(params.operation === 'dot' || params.operation === 'norm' ? 'output.number' : 'output.vector3')))
  }
  private installInputs(op: VectorMathOperation, p: VectorMathParams): void {
    if (['add', 'subtract', 'dot', 'cross'].includes(op)) {
      if (!this.inputs.a) this.addInput('a', new ClassicPreset.Input(vector3Socket, t('input.a')))
      if (!this.inputs.b) this.addInput('b', new ClassicPreset.Input(vector3Socket, t('input.b')))
    } else {
      if (!this.inputs.vector) this.addInput('vector', new ClassicPreset.Input(vector3Socket, t('input.vector')))
      if (op === 'scale' || op === 'divide') {
        const key = op === 'scale' ? 'factor' : 'divisor'
        const label = op === 'scale' ? t('input.factor') : t('input.divisor')
        if (!this.inputs[key]) this.addInput(key, new ClassicPreset.Input(numberSocket, label))
        if (!this.controls[key]) this.addControl(key, new LabeledNumberControl(label, { initial: p.factor }))
      }
    }
  }
  private outputType(op: VectorMathOperation) { return op === 'dot' || op === 'norm' ? numberSocket : vector3Socket }
  setOperation(operation: VectorMathOperation): void {
    const control = this.controls.operation as TitleSelectControl<VectorMathOperation>
    if (control.value === operation) return
    const previous = this.getPersistedParams()
    this.scalarFallback = (this.controls.factor as LabeledNumberControl | undefined)?.value ?? (this.controls.divisor as LabeledNumberControl | undefined)?.value ?? previous.factor
    const desired = new Set(['add', 'subtract', 'dot', 'cross'].includes(operation)
      ? ['a', 'b'] : ['vector', ...(operation === 'scale' ? ['factor'] : operation === 'divide' ? ['divisor'] : [])])
    for (const key of Object.keys(this.inputs)) if (!desired.has(key)) this.removeInput(key)
    for (const key of ['factor', 'divisor']) if (!desired.has(key) && this.controls[key]) this.removeControl(key)
    control.value = operation
    this.installInputs(operation, { ...previous, factor: this.scalarFallback })
    if (this.outputs.value?.socket.name !== this.outputType(operation).name) {
      this.removeOutput('value')
      this.addOutput('value', new ClassicPreset.Output(this.outputType(operation), t(operation === 'dot' || operation === 'norm' ? 'output.number' : 'output.vector3')))
    }
  }
  getPersistedParams(): VectorMathParams {
    return { operation: (this.controls.operation as TitleSelectControl<VectorMathOperation>).value, a: 0, b: 0, factor: (this.controls.factor as LabeledNumberControl | undefined)?.value ?? (this.controls.divisor as LabeledNumberControl | undefined)?.value ?? this.scalarFallback }
  }
  data(inputs: Record<string, (NumberValue | Vector3Value)[] | undefined>): { value: NumberValue | Vector3Value } {
    const p = this.getPersistedParams(), op = p.operation
    const needsPair = ['add', 'subtract', 'dot', 'cross'].includes(op)
    const a = inputs.a?.[0]?.code, b = inputs.b?.[0]?.code
    const vector = inputs.vector?.[0]?.code
    if (needsPair && (!a || !b)) throw new Error(`Vector Math ${op} requires both Vector inputs.`)
    if (!needsPair && !vector) throw new Error(`Vector Math ${op} requires a Vector input.`)
    const scalar = op === 'scale' ? inputs.factor?.[0]?.code ?? String((this.controls.factor as LabeledNumberControl)?.value ?? p.factor) : inputs.divisor?.[0]?.code ?? String((this.controls.divisor as LabeledNumberControl)?.value ?? p.factor)
    const code = op === 'add' ? `(${a!} + ${b!})` : op === 'subtract' ? `(${a!} - ${b!})`
      : op === 'scale' ? `(${vector!} * ${scalar})` : op === 'divide' ? `(${vector!} / ${scalar})`
        : op === 'dot' ? `(${a!} * ${b!})` : op === 'cross' ? `cross(${a!}, ${b!})`
          : op === 'norm' ? `norm(${vector!})` : `-(${vector!})`
    return { value: { code } }
  }
}

export interface MinMaxOperand { id: string; value?: number }
export interface MinMaxParams { operation: 'minimum' | 'maximum'; operands: MinMaxOperand[] }
export function validateMinMaxParams(value: unknown): MinMaxParams {
  const params = object(value)
  const operation = exactOperation(params.operation, ['minimum', 'maximum'] as const, 'Min / Max')
  if (!Array.isArray(params.operands) || params.operands.length < 3) throw new Error('Invalid parameters: Min / Max requires at least two fixed operands and one trailing input')
  const operands = params.operands.map((raw) => {
    const item = object(raw)
    if (typeof item.id !== 'string' || !item.id) throw new Error('Invalid parameters: Min / Max operand id must be a non-empty string')
    if (item.value !== undefined && (typeof item.value !== 'number' || !Number.isFinite(item.value))) throw new Error('Invalid parameters: Min / Max operand value must be finite')
    return { id: item.id, ...(item.value === undefined ? {} : { value: item.value }) }
  })
  if (new Set(operands.map((item) => item.id)).size !== operands.length) throw new Error('Invalid parameters: duplicate Min / Max operand ids')
  if (operands[0]?.id !== 'a' || operands[1]?.id !== 'b' || operands[0].value === undefined || operands[1].value === undefined || operands.at(-1)?.value !== undefined) throw new Error('Invalid parameters: invalid Min / Max dynamic input records')
  return { operation, operands }
}

export class MinMaxNode extends ClassicPreset.Node<Record<string, ClassicPreset.Socket>, { value: ClassicPreset.Socket }, Record<string, LabeledNumberControl | TitleSelectControl<'minimum' | 'maximum'>>> implements DataflowNode {
  private operands: MinMaxOperand[]
  onOperandsChanged?: () => void
  constructor(params: MinMaxParams = { operation: 'minimum', operands: [{ id: 'a', value: 0 }, { id: 'b', value: 0 }, { id: 'm1' }] }) {
    super(t('node.minMax'))
    this.operands = structuredClone(params.operands)
    this.addControl('operation', new TitleSelectControl(t('node.minMaxOperation'), [{ value: 'minimum', label: t('math.minimum') }, { value: 'maximum', label: t('math.maximum') }], params.operation))
    this.operands.forEach((item, i) => this.addOperand(item, i))
    this.addOutput('value', new ClassicPreset.Output(numberSocket, t('output.number')))
  }
  private port(id: string): string { return id === 'a' || id === 'b' ? id : `operand:${id}` }
  private addOperand(item: MinMaxOperand, index: number): void {
    const key = this.port(item.id), label = index === 0 ? t('input.a') : index === 1 ? t('input.b') : t('input.operand')
    this.addInput(key, new ClassicPreset.Input(numberSocket, label))
    if (index < 2) this.addControl(key, new LabeledNumberControl(label, { initial: item.value }))
    else this.addControl(key, new OptionalNumberControl(label, { initial: item.value, change: (value) => {
      if (value === undefined && this.operands.at(-1)?.id !== item.id) {
        this.removeInput(key); this.removeControl(key); this.operands = this.operands.filter((candidate) => candidate.id !== item.id); this.onOperandsChanged?.(); return
      }
      if (this.operands.at(-1)?.id !== item.id || value === undefined) return
      const newItem = { id: globalThis.crypto?.randomUUID?.() ?? `operand-${Math.random().toString(36).slice(2)}` }
      this.operands.push(newItem); this.addOperand(newItem, this.operands.length - 1); this.onOperandsChanged?.()
    } }))
  }
  synchronizeOperands(connected: ReadonlySet<string>): boolean {
    let changed = false
    for (let index = this.operands.length - 2; index >= 2; index -= 1) {
      const operand = this.operands[index]!
      const port = this.port(operand.id)
      const value = (this.controls[port] as LabeledNumberControl | undefined)?.value
      if (value === undefined && !connected.has(port)) {
        this.removeInput(port)
        if (this.controls[port]) this.removeControl(port)
        this.operands.splice(index, 1)
        changed = true
      }
    }
    const trailing = this.operands.at(-1)!
    if (connected.has(this.port(trailing.id)) || (this.controls[this.port(trailing.id)] as LabeledNumberControl | undefined)?.value !== undefined) {
      const item = { id: globalThis.crypto?.randomUUID?.() ?? `operand-${Math.random().toString(36).slice(2)}` }
      this.operands.push(item); this.addOperand(item, this.operands.length - 1); changed = true
    }
    return changed
  }
  getPersistedParams(): MinMaxParams {
    return { operation: (this.controls.operation as TitleSelectControl<'minimum' | 'maximum'>).value, operands: this.operands.map((item) => {
      const value = (this.controls[this.port(item.id)] as LabeledNumberControl | undefined)?.value
      return { id: item.id, ...(value === undefined ? {} : { value }) }
    }) }
  }
  data(inputs: Record<string, NumberValue[] | undefined>): { value: NumberValue } {
    const p = this.getPersistedParams()
    const values = p.operands.slice(0, -1).map((item) => inputs[this.port(item.id)]?.[0]?.code ?? (item.value === undefined ? undefined : String(item.value))).filter((value): value is string => value !== undefined)
    return { value: { code: values.length < 2 ? '' : `${p.operation === 'minimum' ? 'min' : 'max'}(${values.join(', ')})` } }
  }
}

export class PiNode extends ClassicPreset.Node<{}, { value: ClassicPreset.Socket }, {}> implements DataflowNode {
  constructor() { super(t('node.pi')); this.addOutput('value', new ClassicPreset.Output(numberSocket, t('output.pi'))) }
  getPersistedParams(): Record<string, never> { return {} }
  data(): { value: NumberValue } { return { value: { code: 'PI' } } }
}

export class BasicMathNode extends UnaryMathNode<BasicMathOperation, BasicMathParams> {
  constructor(params: BasicMathParams = { operation: 'abs', x: 0 }) { super(t('node.basicMath'), t('node.basicMathOperation'), BASIC_MATH_OPERATIONS.map((value) => ({ value, label: value })), params) }
  getPersistedParams(): BasicMathParams { return this.persisted() }
}

export class ExponentialLogNode extends UnaryMathNode<ExponentialLogOperation, ExponentialLogParams> {
  constructor(params: ExponentialLogParams = { operation: 'exp', x: 0 }) { super(t('node.exponentialLog'), t('node.exponentialLogOperation'), EXPONENTIAL_LOG_OPERATIONS.map((value) => ({ value, label: value })), params) }
  getPersistedParams(): ExponentialLogParams { return this.persisted() }
}

/** A deliberately numeric-only comparison. Its Boolean result can feed a
 * Conditional or any existing Boolean parameter without adding implicit
 * OpenSCAD coercions. */
export class CompareNode extends ClassicPreset.Node<{ a: ClassicPreset.Socket; b: ClassicPreset.Socket }, { value: ClassicPreset.Socket }, CompareControls> implements DataflowNode {
  constructor(params: CompareParams = { operator: '<', a: 0, b: 0 }) {
    super(t('node.compare'))
    this.addControl('operator', new TitleSelectControl(t('node.compareOperator'), [
      { value: '<', label: '<' }, { value: '<=', label: '<=' }, { value: '>', label: '>' },
      { value: '>=', label: '>=' }, { value: '==', label: '==' }, { value: '!=', label: '!=' },
    ], params.operator))
    for (const [key, value, labelText] of [['a', params.a, t('input.a')], ['b', params.b, t('input.b')]] as const) {
      this.addInput(key, new ClassicPreset.Input(numberSocket, labelText))
      this.addControl(key, new LabeledNumberControl(labelText, { initial: value }))
    }
    this.addOutput('value', new ClassicPreset.Output(booleanSocket, t('output.boolean')))
  }

  getPersistedParams(): CompareParams {
    return {
      operator: this.controls.operator.value,
      a: this.controls.a.value ?? 0,
      b: this.controls.b.value ?? 0,
    }
  }
  data(inputs: Record<string, NumberValue[] | undefined>): { value: BooleanValue } {
    const params = this.getPersistedParams()
    const a = inputs.a?.[0]?.code ?? String(params.a)
    const b = inputs.b?.[0]?.code ?? String(params.b)
    return { value: { code: `(${a} ${params.operator} ${b})` } }
  }
}

/** OpenSCAD's value-only ternary expression. The `valueType` is inferred by
 * editor connection handling; sockets keep their stable IDs while their
 * visual/semantic type changes in place. */
export class ConditionalNode extends ClassicPreset.Node<Record<string, ClassicPreset.Socket>, { result: ClassicPreset.Socket }> implements DataflowNode {
  private valueType: ConditionalValueType | undefined

  constructor(params: ConditionalParams = {}) {
    super(t('node.conditional'))
    this.valueType = params.valueType
    this.addInput('condition', new ClassicPreset.Input(booleanSocket, t('input.condition')))
    // Multi-connectable prevents ClassicFlow from eagerly removing the old
    // branch wire before editor.ts can preflight a type transition.
    this.addInput('true', new ClassicPreset.Input(socketForConditionalType(this.valueType), t('input.caseTrue'), true))
    this.addInput('false', new ClassicPreset.Input(socketForConditionalType(this.valueType), t('input.caseFalse'), true))
    this.addOutput('result', new ClassicPreset.Output(socketForConditionalType(this.valueType), t('output.result')))
  }

  getValueType(): ConditionalValueType | undefined { return this.valueType }
  getPersistedParams(): ConditionalParams { return this.valueType === undefined ? {} : { valueType: this.valueType } }

  setValueType(valueType: ConditionalValueType | undefined): void {
    this.valueType = valueType
    const socket = socketForConditionalType(valueType)
    this.inputs.true!.socket = socket
    this.inputs.false!.socket = socket
    this.outputs.result!.socket = socket
  }

  data(inputs: Record<string, (NumberValue | BooleanValue | Vector3Value)[] | undefined>): { result: NumberValue | BooleanValue | Vector3Value | undefined } {
    const condition = inputs.condition?.[0]?.code
    const whenTrue = inputs.true?.[0]?.code
    const whenFalse = inputs.false?.[0]?.code
    if (this.valueType === undefined || !condition || !whenTrue || !whenFalse) return { result: undefined }
    return { result: { code: `(${condition} ? ${whenTrue} : ${whenFalse})` } }
  }
}

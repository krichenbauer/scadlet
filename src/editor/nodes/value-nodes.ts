import { ClassicPreset } from 'rete'
import type { DataflowNode } from 'rete-engine'

import { t } from '../../i18n/translate'
import { CheckboxControl, LabeledNumberControl, LabeledTextControl, TitleSelectControl } from '../controls'
import { booleanSocket, numberSocket, unresolvedSocket, vector3Socket, type BooleanValue, type NumberValue, type Vector3Value } from '../sockets'

export interface NumberParams { value: number; name?: string; bindingId?: string }
export interface BooleanParams { value: boolean; name?: string; bindingId?: string }
export interface Vector3ValueParams { x: number; y: number; z: number; name?: string; bindingId?: string }
export type ArithmeticOperation = 'addition' | 'subtraction' | 'multiplication' | 'division' | 'modulo' | 'power'
export interface ArithmeticParams { operation: ArithmeticOperation; a: number; b: number }
export type TrigonometryOperation = 'sin' | 'cos' | 'tan' | 'asin' | 'acos' | 'atan' | 'atan2'
export type TrigonometryInputPort = 'a' | 'b'
export interface TrigonometryParams { operation: TrigonometryOperation; a: number; b: number; inputPorts: TrigonometryInputPort[] }
export type BasicMathOperation = 'abs' | 'sign' | 'sqrt' | 'floor' | 'ceil' | 'round'
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
export const BASIC_MATH_OPERATIONS = ['abs', 'sign', 'sqrt', 'floor', 'ceil', 'round'] as const
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
    return { value: { code: `${params.operation}(${inputs.x?.[0]?.code ?? String(params.x)})` } }
  }
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

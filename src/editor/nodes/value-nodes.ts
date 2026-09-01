import { ClassicPreset } from 'rete'
import type { DataflowNode } from 'rete-engine'

import { t } from '../../i18n/translate'
import { CheckboxControl, LabeledNumberControl } from '../controls'
import { booleanSocket, numberSocket, vector3Socket, type BooleanValue, type NumberValue, type Vector3Value } from '../sockets'

export interface NumberParams { value: number }
export interface BooleanParams { value: boolean }
export interface Vector3ValueParams { x: number; y: number; z: number }
export interface MathParams { a: number; b: number }

function finiteNumber(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`Invalid parameters: "${name}" must be a finite number`)
  return value
}

function object(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Invalid parameters: expected an object')
  return value as Record<string, unknown>
}

export function validateNumberParams(value: unknown): NumberParams {
  const params = object(value)
  return { value: finiteNumber(params.value, 'value') }
}

export function validateBooleanParams(value: unknown): BooleanParams {
  const params = object(value)
  if (typeof params.value !== 'boolean') throw new Error('Invalid parameters: "value" must be a boolean')
  return { value: params.value }
}

export function validateVector3ValueParams(value: unknown): Vector3ValueParams {
  const params = object(value)
  return { x: finiteNumber(params.x, 'x'), y: finiteNumber(params.y, 'y'), z: finiteNumber(params.z, 'z') }
}

export function validateMathParams(value: unknown): MathParams {
  const params = object(value)
  return { a: finiteNumber(params.a, 'a'), b: finiteNumber(params.b, 'b') }
}

/** A literal Number is an OpenSCAD expression source, never a JavaScript calculation. */
export class NumberNode extends ClassicPreset.Node<{}, { value: ClassicPreset.Socket }, { value: LabeledNumberControl }> implements DataflowNode {
  constructor(params: NumberParams = { value: 10 }) {
    super(t('node.number'))
    this.addControl('value', new LabeledNumberControl(t('control.value'), { initial: params.value }))
    this.addOutput('value', new ClassicPreset.Output(numberSocket, t('control.value')))
  }

  getPersistedParams(): NumberParams { return { value: this.controls.value.value ?? 0 } }
  data(): { value: NumberValue } { return { value: { code: String(this.controls.value.value ?? 0) } } }
}

export class BooleanNode extends ClassicPreset.Node<{}, { value: ClassicPreset.Socket }, { value: CheckboxControl }> implements DataflowNode {
  constructor(params: BooleanParams = { value: false }) {
    super(t('node.boolean'))
    this.addControl('value', new CheckboxControl(t('control.value'), params.value))
    this.addOutput('value', new ClassicPreset.Output(booleanSocket, t('control.value')))
  }

  getPersistedParams(): BooleanParams { return { value: this.controls.value.value } }
  data(): { value: BooleanValue } { return { value: { code: this.controls.value.value ? 'true' : 'false' } } }
}

export class Vector3Node extends ClassicPreset.Node<Record<string, ClassicPreset.Socket>, { value: ClassicPreset.Socket }, Record<string, LabeledNumberControl>> implements DataflowNode {
  constructor(params: Vector3ValueParams = { x: 0, y: 0, z: 0 }) {
    super(t('node.vector3'))
    for (const [key, label] of [['x', t('control.x')], ['y', t('control.y')], ['z', t('control.z')]] as const) {
      this.addInput(key, new ClassicPreset.Input(numberSocket, label))
      this.addControl(key, new LabeledNumberControl(label, { initial: params[key] }))
    }
    this.addOutput('value', new ClassicPreset.Output(vector3Socket, t('control.value')))
  }

  getPersistedParams(): Vector3ValueParams {
    return { x: this.controls.x.value ?? 0, y: this.controls.y.value ?? 0, z: this.controls.z.value ?? 0 }
  }

  data(inputs: Record<string, NumberValue[] | undefined>): { value: Vector3Value } {
    const params = this.getPersistedParams()
    const x = inputs.x?.[0]?.code ?? String(params.x)
    const y = inputs.y?.[0]?.code ?? String(params.y)
    const z = inputs.z?.[0]?.code ?? String(params.z)
    return { value: { code: `[${x}, ${y}, ${z}]` } }
  }
}

export type MathOperator = '+' | '-' | '*' | '/'

/** The four small arithmetic nodes share only their stable operator and label;
 * their output deliberately preserves explicit grouping for OpenSCAD. */
export class MathNode extends ClassicPreset.Node<Record<string, ClassicPreset.Socket>, { value: ClassicPreset.Socket }, Record<string, LabeledNumberControl>> implements DataflowNode {
  private readonly operator: MathOperator
  readonly type: string

  constructor(label: string, operator: MathOperator, type: string, params: MathParams = { a: 0, b: 0 }) {
    super(label)
    this.operator = operator
    this.type = type
    for (const [key, value, labelText] of [['a', params.a, t('input.a')], ['b', params.b, t('input.b')]] as const) {
      this.addInput(key, new ClassicPreset.Input(numberSocket, labelText))
      this.addControl(key, new LabeledNumberControl(labelText, { initial: value }))
    }
    this.addOutput('value', new ClassicPreset.Output(numberSocket, t('control.value')))
  }

  getPersistedParams(): MathParams { return { a: this.controls.a.value ?? 0, b: this.controls.b.value ?? 0 } }
  data(inputs: Record<string, NumberValue[] | undefined>): { value: NumberValue } {
    const params = this.getPersistedParams()
    const a = inputs.a?.[0]?.code ?? String(params.a)
    const b = inputs.b?.[0]?.code ?? String(params.b)
    return { value: { code: `(${a} ${this.operator} ${b})` } }
  }
}

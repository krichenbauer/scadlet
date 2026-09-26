import { ClassicPreset } from 'rete'
import type { DataflowNode } from 'rete-engine'

import { t } from '../../i18n/translate'
import { isOpenSCADIdentifier } from '../definitions'
import { LabeledNumberControl, LabeledTextControl } from '../controls'
import { geometrySocket, numberSocket, structureSocket, type GeometryValue, type NumberValue } from '../sockets'

export interface ForHeaderParams {
  pairId: string
  bindingId: string
  name: string
  start: number
  step: number
  end: number
}

export interface ForResultParams {
  pairId: string
  children: { id: string }[]
}

export interface ForStructureValue {
  pairId: string
  iterator: string
  start: string
  step: string
  end: string
}

function object(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Invalid parameters: expected an object')
  return value as Record<string, unknown>
}

function nonEmptyString(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`Invalid parameters: "${name}" must be a non-empty string`)
  return value
}

function finiteNumber(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`Invalid parameters: "${name}" must be a finite number`)
  return value
}

export function validateForHeaderParams(value: unknown): ForHeaderParams {
  const params = object(value)
  const name = nonEmptyString(params.name, 'name')
  if (!isOpenSCADIdentifier(name)) throw new Error('Invalid parameters: "name" must be a valid OpenSCAD identifier')
  return {
    pairId: nonEmptyString(params.pairId, 'pairId'),
    bindingId: nonEmptyString(params.bindingId, 'bindingId'),
    name,
    start: finiteNumber(params.start, 'start'),
    step: finiteNumber(params.step, 'step'),
    end: finiteNumber(params.end, 'end'),
  }
}

export function validateForResultParams(value: unknown): ForResultParams {
  const params = object(value)
  if (!Array.isArray(params.children) || params.children.length === 0) throw new Error('Invalid parameters: "children" must contain at least one slot')
  const seen = new Set<string>()
  const children = params.children.map((child, index) => {
    const item = object(child)
    const id = nonEmptyString(item.id, `children[${index}].id`)
    if (seen.has(id)) throw new Error(`Invalid parameters: duplicate child slot id "${id}"`)
    seen.add(id)
    return { id }
  })
  return { pairId: nonEmptyString(params.pairId, 'pairId'), children }
}

function numericLiteralIsZero(code: string): boolean {
  const normalized = code.trim().replace(/^\((.*)\)$/u, '$1').trim()
  return /^[-+]?0+(?:\.0*)?(?:e[-+]?\d+)?$/iu.test(normalized)
}

function indent(code: string): string {
  return code.split('\n').map((line) => `  ${line}`).join('\n')
}

export function forToOpenSCAD(structure: ForStructureValue, body: readonly string[]): string {
  if (numericLiteralIsZero(structure.step)) throw new Error(t('for.zeroStep'))
  return `for (${structure.iterator} = [${structure.start} : ${structure.step} : ${structure.end}]) {\n${indent(body.join('\n'))}\n}`
}

export class ForHeaderNode extends ClassicPreset.Node<
  { start: ClassicPreset.Socket; step: ClassicPreset.Socket; end: ClassicPreset.Socket },
  { value: ClassicPreset.Socket; loop: ClassicPreset.Socket },
  { name: LabeledTextControl; start: LabeledNumberControl; step: LabeledNumberControl; end: LabeledNumberControl }
> implements DataflowNode {
  readonly pairId: string
  readonly bindingId: string

  constructor(params: ForHeaderParams) {
    super(t('node.for'))
    this.pairId = params.pairId
    this.bindingId = params.bindingId
    this.addControl('name', new LabeledTextControl(t('for.iterator'), { initial: params.name }))
    for (const key of ['start', 'step', 'end'] as const) {
      this.addInput(key, new ClassicPreset.Input(numberSocket, t(`for.${key}`)))
      this.addControl(key, new LabeledNumberControl(t(`for.${key}`), { initial: params[key] }))
    }
    this.addOutput('value', new ClassicPreset.Output(numberSocket, t('for.iterator')))
    this.addOutput('loop', new ClassicPreset.Output(structureSocket, t('for.structure')))
  }

  getBindingId(): string { return this.bindingId }
  getBindingName(): string { return this.controls.name.value ?? '' }
  renameBinding(name: string): void { this.controls.name.setValue(name) }
  getPersistedParams(): ForHeaderParams {
    return {
      pairId: this.pairId,
      bindingId: this.bindingId,
      name: this.getBindingName(),
      start: this.controls.start.value ?? 0,
      step: this.controls.step.value ?? 1,
      end: this.controls.end.value ?? 10,
    }
  }

  data(inputs: { start?: NumberValue[]; step?: NumberValue[]; end?: NumberValue[] }): { value: NumberValue; loop: ForStructureValue } {
    const params = this.getPersistedParams()
    const structure = {
      pairId: this.pairId,
      iterator: params.name,
      start: inputs.start?.[0]?.code ?? String(params.start),
      step: inputs.step?.[0]?.code ?? String(params.step),
      end: inputs.end?.[0]?.code ?? String(params.end),
    }
    return { value: { code: params.name }, loop: structure }
  }
}

export class ForResultNode extends ClassicPreset.Node<
  Record<string, ClassicPreset.Socket>,
  { geometry: ClassicPreset.Socket },
  Record<string, never>
> implements DataflowNode {
  readonly pairId: string
  private slots: string[]

  constructor(params: ForResultParams) {
    super(t('node.forResult'))
    this.pairId = params.pairId
    this.slots = params.children.map((child) => child.id)
    this.addInput('loop', new ClassicPreset.Input(structureSocket, t('for.structure')))
    for (const slot of this.slots) this.addInput(this.port(slot), new ClassicPreset.Input(geometrySocket, t('input.geometryChild')))
    this.addOutput('geometry', new ClassicPreset.Output(geometrySocket, t('input.geometry')))
  }

  private newSlotId(): string { return globalThis.crypto?.randomUUID?.() ?? `child-${Math.random().toString(36).slice(2)}` }
  private port(id: string): string { return `child:${id}` }
  synchronizeChildren(connectedInputs: ReadonlySet<string>): boolean {
    const last = this.slots[this.slots.length - 1]!
    if (!connectedInputs.has(this.port(last))) return false
    const id = this.newSlotId()
    this.slots.push(id)
    this.addInput(this.port(id), new ClassicPreset.Input(geometrySocket, t('input.geometryChild')))
    return true
  }
  isInputPort(port: string): boolean { return this.slots.some((slot) => this.port(slot) === port) }
  isExtensionPort(port: string): boolean { return this.port(this.slots[this.slots.length - 1]!) === port }
  getPersistedParams(): ForResultParams { return { pairId: this.pairId, children: this.slots.map((id) => ({ id })) } }

  data(inputs: Record<string, (GeometryValue | ForStructureValue)[] | undefined>): { geometry: GeometryValue } {
    const structure = inputs.loop?.[0] as ForStructureValue | undefined
    const body = this.slots
      .map((slot) => (inputs[this.port(slot)]?.[0] as GeometryValue | undefined)?.code)
      .filter((code): code is string => Boolean(code))
    if (!structure || structure.pairId !== this.pairId) return { geometry: { code: '', error: 'incomplete For pair' } }
    if (body.length === 0) return { geometry: { code: '' } }
    return { geometry: { code: forToOpenSCAD(structure, body) } }
  }
}

export function createDefaultForParams(): { header: ForHeaderParams; result: ForResultParams } {
  const id = (): string => globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2)
  const pairId = id()
  return {
    header: { pairId, bindingId: id(), name: 'i', start: 0, step: 1, end: 10 },
    result: { pairId, children: [{ id: id() }] },
  }
}

import { ClassicPreset } from 'rete'
import type { DataflowNode } from 'rete-engine'
import { sphereToOpenSCAD, type SphereParams, type SphereSizeMode } from '../../openscad/sphere'
import { t } from '../../i18n/translate'
import { LabeledNumberControl, ParameterActionsControl, type ParameterAction, type RemovableRow } from '../controls'
import { geometrySocket, numberSocket, type GeometryValue, type NumberValue } from '../sockets'

type SphereControls = Record<string, ClassicPreset.Control> & { r: LabeledNumberControl; d: LabeledNumberControl; fn: LabeledNumberControl; actions: ParameterActionsControl }

const SIZE_MODES: readonly { value: SphereSizeMode; label: string }[] = [
  { value: 'radius', label: t('mode.radius') }, { value: 'diameter', label: t('mode.diameter') },
]

export class SphereNode extends ClassicPreset.Node<Record<string, ClassicPreset.Socket>, { geometry: ClassicPreset.Socket }, SphereControls> implements DataflowNode {
  private readonly notify?: () => void
  private readonly requestRemoveForm?: (keys: readonly string[], label: string) => Promise<boolean>
  private values: SphereParams
  constructor(params: Partial<SphereParams> = {}, notify?: () => void, requestRemoveForm?: (keys: readonly string[], label: string) => Promise<boolean>) {
    super(t('node.sphere')); this.notify = notify; this.requestRemoveForm = requestRemoveForm; this.values = Object.keys(params).length === 0 && notify === undefined ? { mode: 'radius', r: 5, d: 10 } : { ...params }
    if (params.mode) this.addSize(params.mode)
    if (params.fn !== undefined) this.addNumber('fn', t('control.fn'), params.fn)
    this.addControl('actions', new ParameterActionsControl(() => this.actions()))
    this.addOutput('geometry', new ClassicPreset.Output(geometrySocket, t('input.geometry')))
  }
  private addNumber(key: 'r' | 'd' | 'fn', label: string, value: number): void { this.values[key] = value; this.addInput(key, new ClassicPreset.Input(numberSocket, label)); this.addControl(key, new LabeledNumberControl(label, { initial: value, change: (v) => { this.values[key] = v } })) }
  private addSize(mode: SphereSizeMode): void {
    this.values.mode = mode
    this.addNumber(mode === 'radius' ? 'r' : 'd', mode === 'radius' ? t('control.radius') : t('control.diameter'), mode === 'radius' ? this.values.r ?? 5 : this.values.d ?? 10)
  }
  private removeSizePorts(): void {
    for (const key of ['r', 'd']) { if (this.controls[key]) this.removeControl(key); if (this.inputs[key]) this.removeInput(key) }
    delete this.values.mode; delete this.values.r; delete this.values.d
  }
  private sizeInputKeys(): string[] { return ['r', 'd'].filter((key) => Boolean(this.inputs[key])) }
  private async requestRemoveKeys(keys: readonly string[], label: string, apply: () => void): Promise<boolean> {
    if (!(await (this.requestRemoveForm?.(keys, label) ?? Promise.resolve(true)))) return false
    apply(); this.notify?.(); return true
  }
  /** Header Add menu entries - only forms/categories not currently present. */
  private actions(): readonly ParameterAction[] {
    const result: ParameterAction[] = []
    if (!this.values.mode) {
      result.push({
        id: 'add-size', label: t('control.size'), children: SIZE_MODES.map(({ value, label }) => ({
          id: `add-size-${value}`, label, run: () => { this.addSize(value); this.notify?.() },
        })),
      })
    }
    if (this.values.fn === undefined) result.push({ id: 'add-fn', label: t('control.fn'), run: () => { this.addNumber('fn', t('control.fn'), 30); this.notify?.() } })
    return result
  }
  /** Row-level Remove buttons: one designated row per removable form. */
  removableRows(): readonly RemovableRow[] {
    const rows: RemovableRow[] = []
    const sizeKeys = this.sizeInputKeys()
    if (sizeKeys.length > 0) rows.push({ key: sizeKeys[0]!, label: t('control.size'), requestRemove: () => this.requestRemoveKeys(sizeKeys, t('control.size'), () => this.removeSizePorts()) })
    if (this.values.fn !== undefined) rows.push({ key: 'fn', label: t('control.fn'), requestRemove: () => this.requestRemoveKeys(['fn'], t('control.fn'), () => { if (this.controls.fn) this.removeControl('fn'); if (this.inputs.fn) this.removeInput('fn'); delete this.values.fn }) })
    return rows
  }
  getPersistedParams(): SphereParams { const result = { ...this.values }; for (const key of ['r', 'd', 'fn'] as const) { const control = this.controls[key]; if (control instanceof LabeledNumberControl) result[key] = control.value ?? result[key] } return result }
  data(inputs: Record<string, NumberValue[] | undefined>): { geometry: GeometryValue } { const params = this.getPersistedParams(); if (!inputs.r?.[0] && !inputs.d?.[0] && !inputs.fn?.[0]) return { geometry: { code: sphereToOpenSCAD(params) } }; const named: string[] = []; if (params.mode === 'radius' && params.r !== undefined) named.push(`r=${inputs.r?.[0]?.code ?? params.r}`); if (params.mode === 'diameter' && params.d !== undefined) named.push(`d=${inputs.d?.[0]?.code ?? params.d}`); if (params.fn !== undefined) named.push(`$fn=${inputs.fn?.[0]?.code ?? params.fn}`); return { geometry: { code: `sphere(${named.join(', ')});` } } }
}

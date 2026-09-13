import { ClassicPreset } from 'rete'
import type { DataflowNode } from 'rete-engine'

import { cylinderToOpenSCAD, type CylinderParams, type CylinderSizeMode } from '../../openscad/cylinder'
import { t } from '../../i18n/translate'
import { CheckboxControl, LabeledNumberControl, ParameterActionsControl, type ParameterAction, type RemovableRow } from '../controls'
import { booleanSocket, geometrySocket, numberSocket, type BooleanValue, type GeometryValue, type NumberValue } from '../sockets'

type CylinderControls = Record<string, ClassicPreset.Control> & {
  h: LabeledNumberControl; r: LabeledNumberControl; d: LabeledNumberControl
  r1: LabeledNumberControl; r2: LabeledNumberControl; center: CheckboxControl; fn: LabeledNumberControl
  actions: ParameterActionsControl
}
const MODES: readonly { value: CylinderSizeMode; label: string }[] = [
  { value: 'radius', label: t('mode.radius') }, { value: 'diameter', label: t('mode.diameter') }, { value: 'tapered', label: t('mode.tapered') },
]

/** OpenSCAD's optional cylinder signature. A field exists only after the
 * user adds it through the header Add menu; literals and typed Number
 * inputs use the same port name. */
export class CylinderNode extends ClassicPreset.Node<Record<string, ClassicPreset.Socket>, { geometry: ClassicPreset.Socket }, CylinderControls> implements DataflowNode {
  private readonly notify?: () => void
  private readonly requestRemoveForm?: (keys: readonly string[], label: string) => Promise<boolean>
  private values: CylinderParams

  constructor(params: Partial<CylinderParams> = {}, notify?: () => void, requestRemoveForm?: (keys: readonly string[], label: string) => Promise<boolean>) {
    super(t('node.cylinder'))
    this.notify = notify
    this.requestRemoveForm = requestRemoveForm
    this.values = Object.keys(params).length === 0 && notify === undefined ? { h: 10, mode: 'radius', r: 5, d: 10, r1: 5, r2: 5, center: false } : { ...params }
    if (params.h !== undefined) this.addNumber('h', t('control.height'), params.h)
    if (params.mode !== undefined) this.addSize(params.mode)
    if (params.center !== undefined) this.addCenter(params.center)
    if (params.fn !== undefined) this.addNumber('fn', t('control.fn'), params.fn)
    this.addControl('actions', new ParameterActionsControl(() => this.actions()))
    this.addOutput('geometry', new ClassicPreset.Output(geometrySocket, t('input.geometry')))
  }

  private changed(): void { this.notify?.() }
  private addNumber(key: keyof Pick<CylinderParams, 'h' | 'r' | 'd' | 'r1' | 'r2' | 'fn'>, label: string, value: number): void {
    this.values[key] = value
    this.addInput(key, new ClassicPreset.Input(numberSocket, label))
    this.addControl(key, new LabeledNumberControl(label, { initial: value, change: (next) => { this.values[key] = next } }))
  }
  private addSize(mode: CylinderSizeMode): void {
    this.values.mode = mode
    if (mode === 'radius') this.addNumber('r', t('control.radius'), this.values.r ?? 5)
    if (mode === 'diameter') this.addNumber('d', t('control.diameter'), this.values.d ?? 10)
    if (mode === 'tapered') { this.addNumber('r1', t('control.radiusBottom'), this.values.r1 ?? 5); this.addNumber('r2', t('control.radiusTop'), this.values.r2 ?? 5) }
  }
  private removeSizePorts(): void {
    for (const key of ['r', 'd', 'r1', 'r2']) {
      if (this.controls[key]) this.removeControl(key)
      if (this.inputs[key]) this.removeInput(key)
    }
    delete this.values.mode; delete this.values.r; delete this.values.d; delete this.values.r1; delete this.values.r2
  }
  private sizeInputKeys(): string[] { return ['r', 'd', 'r1', 'r2'].filter((key) => Boolean(this.inputs[key])) }
  private addCenter(value: boolean): void {
    this.values.center = value
    this.addInput('center', new ClassicPreset.Input(booleanSocket, t('control.center')))
    this.addControl('center', new CheckboxControl(t('control.center'), value))
  }

  /** Header Add menu entries - only forms/categories not currently present. */
  private actions(): readonly ParameterAction[] {
    const actions: ParameterAction[] = []
    if (this.values.h === undefined) actions.push({ id: 'add-height', label: t('menu.addHeight'), run: () => { this.addNumber('h', t('control.height'), 10); this.changed() } })
    if (!this.values.mode) {
      actions.push({
        id: 'add-size', label: t('control.size'), children: MODES.map(({ value, label }) => ({
          id: `add-size-${value}`, label, run: () => { this.addSize(value); this.changed() },
        })),
      })
    }
    if (this.values.center === undefined) actions.push({ id: 'add-center', label: t('control.center'), run: () => { this.addCenter(false); this.changed() } })
    if (this.values.fn === undefined) actions.push({ id: 'add-fn', label: t('control.fn'), run: () => { this.addNumber('fn', t('control.fn'), 30); this.changed() } })
    return actions
  }

  private async requestRemoveKeys(keys: readonly string[], label: string, apply: () => void): Promise<boolean> {
    if (!(await (this.requestRemoveForm?.(keys, label) ?? Promise.resolve(true)))) return false
    apply()
    this.changed()
    return true
  }

  /** Row-level Remove buttons: one designated row per removable form. */
  removableRows(): readonly RemovableRow[] {
    const rows: RemovableRow[] = []
    if (this.values.h !== undefined) rows.push({ key: 'h', label: t('control.height'), requestRemove: () => this.requestRemoveKeys(['h'], t('control.height'), () => { if (this.controls.h) this.removeControl('h'); if (this.inputs.h) this.removeInput('h'); delete this.values.h }) })
    const sizeKeys = this.sizeInputKeys()
    if (sizeKeys.length > 0) rows.push({ key: sizeKeys[0]!, label: t('control.size'), requestRemove: () => this.requestRemoveKeys(sizeKeys, t('control.size'), () => this.removeSizePorts()) })
    if (this.values.center !== undefined) rows.push({ key: 'center', label: t('control.center'), requestRemove: () => this.requestRemoveKeys(['center'], t('control.center'), () => { this.removeControl('center'); this.removeInput('center'); delete this.values.center }) })
    if (this.values.fn !== undefined) rows.push({ key: 'fn', label: t('control.fn'), requestRemove: () => this.requestRemoveKeys(['fn'], t('control.fn'), () => { if (this.controls.fn) this.removeControl('fn'); if (this.inputs.fn) this.removeInput('fn'); delete this.values.fn }) })
    return rows
  }

  getPersistedParams(): CylinderParams {
    const result: CylinderParams = { ...this.values }
    for (const key of ['h', 'r', 'd', 'r1', 'r2', 'fn'] as const) {
      const control = this.controls[key]
      if (control instanceof LabeledNumberControl) result[key] = control.value ?? this.values[key]
    }
    const center = this.controls.center
    if (center instanceof CheckboxControl) result.center = center.value
    return result
  }
  data(inputs: Record<string, (NumberValue | BooleanValue)[] | undefined>): { geometry: GeometryValue } {
    const params = this.getPersistedParams()
    if (!Object.values(inputs).some((values) => values?.[0])) return { geometry: { code: cylinderToOpenSCAD(params) } }
    const named: string[] = []
    if (params.h !== undefined) named.push(`h=${inputs.h?.[0]?.code ?? params.h}`)
    if (params.mode === 'radius' && params.r !== undefined) named.push(`r=${inputs.r?.[0]?.code ?? params.r}`)
    if (params.mode === 'diameter' && params.d !== undefined) named.push(`d=${inputs.d?.[0]?.code ?? params.d}`)
    if (params.mode === 'tapered') { if (params.r1 !== undefined) named.push(`r1=${inputs.r1?.[0]?.code ?? params.r1}`); if (params.r2 !== undefined) named.push(`r2=${inputs.r2?.[0]?.code ?? params.r2}`) }
    const center = inputs.center?.[0]?.code
    if (center) named.push(`center=${center}`)
    else if (params.center) named.push('center=true')
    if (params.fn !== undefined) named.push(`$fn=${inputs.fn?.[0]?.code ?? params.fn}`)
    return { geometry: { code: `cylinder(${named.join(', ')});` } }
  }
}

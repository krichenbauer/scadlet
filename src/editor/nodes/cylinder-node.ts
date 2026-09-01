import { ClassicPreset } from 'rete'
import type { DataflowNode } from 'rete-engine'

import { cylinderToOpenSCAD, type CylinderParams, type CylinderSizeMode } from '../../openscad/cylinder'
import { CheckboxControl, LabeledNumberControl, ParameterActionsControl, SelectControl } from '../controls'
import { geometrySocket, numberSocket, type GeometryValue, type NumberValue } from '../sockets'

type CylinderControls = Record<string, ClassicPreset.Control> & {
  h: LabeledNumberControl; mode: SelectControl<CylinderSizeMode>; r: LabeledNumberControl; d: LabeledNumberControl
  r1: LabeledNumberControl; r2: LabeledNumberControl; center: CheckboxControl; fn: LabeledNumberControl; fnEnabled: CheckboxControl
}
const MODES: readonly { value: CylinderSizeMode; label: string }[] = [
  { value: 'radius', label: 'Radius' }, { value: 'diameter', label: 'Diameter' }, { value: 'tapered', label: 'Tapered' },
]

/** OpenSCAD's optional cylinder signature. A field exists only after the
 * user adds it; literals and typed Number inputs use the same port name. */
export class CylinderNode extends ClassicPreset.Node<Record<string, ClassicPreset.Socket>, { geometry: ClassicPreset.Socket }, CylinderControls> implements DataflowNode {
  private readonly notify?: () => void
  private values: CylinderParams

  constructor(params: Partial<CylinderParams> = {}, notify?: () => void) {
    super('Cylinder')
    this.notify = notify
    this.values = Object.keys(params).length === 0 && notify === undefined ? { h: 10, mode: 'radius', r: 5, d: 10, r1: 5, r2: 5, center: false } : { ...params }
    if (params.h !== undefined) this.addNumber('h', 'H', params.h)
    if (params.mode !== undefined) this.addSize(params.mode)
    if (params.center !== undefined) this.addCenter(params.center)
    if (params.fn !== undefined) this.addNumber('fn', '$fn', params.fn)
    this.addControl('actions', new ParameterActionsControl(() => this.actions()))
    this.addOutput('geometry', new ClassicPreset.Output(geometrySocket, 'Geometry'))
  }

  private changed(): void { this.notify?.() }
  private addNumber(key: keyof Pick<CylinderParams, 'h' | 'r' | 'd' | 'r1' | 'r2' | 'fn'>, label: string, value: number): void {
    this.values[key] = value
    this.addInput(key, new ClassicPreset.Input(numberSocket, label))
    this.addControl(key, new LabeledNumberControl(label, { initial: value, change: (next) => { this.values[key] = next } }))
  }
  private addSize(mode: CylinderSizeMode): void {
    const previous = { ...this.values }
    this.removeSize()
    this.values = { ...this.values, ...previous }
    this.values.mode = mode
    this.addControl('mode', new SelectControl('Size', MODES, mode))
    const select = this.controls.mode as SelectControl<CylinderSizeMode>
    select.onChange = (next) => { this.addSize(next); this.changed() }
    if (mode === 'radius') this.addNumber('r', 'R', this.values.r ?? 5)
    if (mode === 'diameter') this.addNumber('d', 'D', this.values.d ?? 10)
    if (mode === 'tapered') { this.addNumber('r1', 'R1', this.values.r1 ?? 5); this.addNumber('r2', 'R2', this.values.r2 ?? 5) }
  }
  private removeSize(): void {
    for (const key of ['mode', 'r', 'd', 'r1', 'r2']) {
      if (this.controls[key]) this.removeControl(key)
      if (this.inputs[key]) this.removeInput(key)
    }
    delete this.values.mode; delete this.values.r; delete this.values.d; delete this.values.r1; delete this.values.r2
  }
  private addCenter(value: boolean): void { this.values.center = value; this.addControl('center', new CheckboxControl('Center', value)) }
  private actions(): readonly { id: string; label: string; run: () => void }[] {
    const actions: { id: string; label: string; run: () => void }[] = []
    if (this.values.h === undefined) actions.push({ id: 'h', label: '+ Height', run: () => { this.addNumber('h', 'H', 10); this.changed() } })
    if (!this.controls.mode) actions.push({ id: 'size', label: '+ Size', run: () => { this.addSize('radius'); this.changed() } })
    if (this.values.center === undefined) actions.push({ id: 'center', label: '+ Center', run: () => { this.addCenter(false); this.changed() } })
    if (this.values.fn === undefined) actions.push({ id: 'fn', label: '+ $fn', run: () => { this.addNumber('fn', '$fn', 30); this.changed() } })
    return actions
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
  data(inputs: Record<string, NumberValue[] | undefined>): { geometry: GeometryValue } {
    const params = this.getPersistedParams()
    if (!Object.values(inputs).some((values) => values?.[0])) return { geometry: { code: cylinderToOpenSCAD(params) } }
    const named: string[] = []
    if (params.h !== undefined) named.push(`h=${inputs.h?.[0]?.code ?? params.h}`)
    if (params.mode === 'radius' && params.r !== undefined) named.push(`r=${inputs.r?.[0]?.code ?? params.r}`)
    if (params.mode === 'diameter' && params.d !== undefined) named.push(`d=${inputs.d?.[0]?.code ?? params.d}`)
    if (params.mode === 'tapered') { if (params.r1 !== undefined) named.push(`r1=${inputs.r1?.[0]?.code ?? params.r1}`); if (params.r2 !== undefined) named.push(`r2=${inputs.r2?.[0]?.code ?? params.r2}`) }
    if (params.center) named.push('center=true')
    if (params.fn !== undefined) named.push(`$fn=${inputs.fn?.[0]?.code ?? params.fn}`)
    return { geometry: { code: `cylinder(${named.join(', ')});` } }
  }
}

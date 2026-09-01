import { ClassicPreset } from 'rete'
import type { DataflowNode } from 'rete-engine'
import { sphereToOpenSCAD, type SphereParams, type SphereSizeMode } from '../../openscad/sphere'
import { CheckboxControl, LabeledNumberControl, ParameterActionsControl, SelectControl } from '../controls'
import { geometrySocket, numberSocket, type GeometryValue, type NumberValue } from '../sockets'

type SphereControls = Record<string, ClassicPreset.Control> & { mode: SelectControl<SphereSizeMode>; r: LabeledNumberControl; d: LabeledNumberControl; fn: LabeledNumberControl; fnEnabled: CheckboxControl }

export class SphereNode extends ClassicPreset.Node<Record<string, ClassicPreset.Socket>, { geometry: ClassicPreset.Socket }, SphereControls> implements DataflowNode {
  private readonly notify?: () => void
  private values: SphereParams
  constructor(params: Partial<SphereParams> = {}, notify?: () => void) {
    super('Sphere'); this.notify = notify; this.values = Object.keys(params).length === 0 && notify === undefined ? { mode: 'radius', r: 5, d: 10 } : { ...params }
    if (params.mode) this.addSize(params.mode)
    if (params.fn !== undefined) this.addNumber('fn', '$fn', params.fn)
    this.addControl('actions', new ParameterActionsControl(() => this.actions()))
    this.addOutput('geometry', new ClassicPreset.Output(geometrySocket, 'Geometry'))
  }
  private addNumber(key: 'r' | 'd' | 'fn', label: string, value: number): void { this.values[key] = value; this.addInput(key, new ClassicPreset.Input(numberSocket, label)); this.addControl(key, new LabeledNumberControl(label, { initial: value, change: (v) => { this.values[key] = v } })) }
  private addSize(mode: SphereSizeMode): void {
    const previous = { ...this.values }
    for (const key of ['mode', 'r', 'd']) { if (this.controls[key]) this.removeControl(key); if (this.inputs[key]) this.removeInput(key) }
    delete this.values.r; delete this.values.d; this.values = { ...this.values, ...previous, mode }
    const control = new SelectControl<SphereSizeMode>('Size', [{ value: 'radius', label: 'Radius' }, { value: 'diameter', label: 'Diameter' }], mode)
    control.onChange = (next) => { this.addSize(next); this.notify?.() }
    this.addControl('mode', control); this.addNumber(mode === 'radius' ? 'r' : 'd', mode === 'radius' ? 'R' : 'D', mode === 'radius' ? this.values.r ?? 5 : this.values.d ?? 10)
  }
  private actions(): readonly { id: string; label: string; run: () => void }[] { const result: { id: string; label: string; run: () => void }[] = []; if (!this.controls.mode) result.push({ id: 'size', label: '+ Size', run: () => { this.addSize('radius'); this.notify?.() } }); if (this.values.fn === undefined) result.push({ id: 'fn', label: '+ $fn', run: () => { this.addNumber('fn', '$fn', 30); this.notify?.() } }); return result }
  getPersistedParams(): SphereParams { const result = { ...this.values }; for (const key of ['r', 'd', 'fn'] as const) { const control = this.controls[key]; if (control instanceof LabeledNumberControl) result[key] = control.value ?? result[key] } return result }
  data(inputs: Record<string, NumberValue[] | undefined>): { geometry: GeometryValue } { const params = this.getPersistedParams(); if (!inputs.r?.[0] && !inputs.d?.[0] && !inputs.fn?.[0]) return { geometry: { code: sphereToOpenSCAD(params) } }; const named: string[] = []; if (params.mode === 'radius' && params.r !== undefined) named.push(`r=${inputs.r?.[0]?.code ?? params.r}`); if (params.mode === 'diameter' && params.d !== undefined) named.push(`d=${inputs.d?.[0]?.code ?? params.d}`); if (params.fn !== undefined) named.push(`$fn=${inputs.fn?.[0]?.code ?? params.fn}`); return { geometry: { code: `sphere(${named.join(', ')});` } } }
}

import { ClassicPreset } from 'rete'
import type { DataflowNode } from 'rete-engine'

import { cubeToOpenSCAD, type CubeParams, type Vector3Params } from '../../openscad/cube'
import { CheckboxControl, LabeledNumberControl, ParameterActionsControl, SelectControl } from '../controls'
import { geometrySocket, numberSocket, vector3Socket, type GeometryValue, type NumberValue, type Vector3Value } from '../sockets'

type CubeControls = {
  sizeMode: SelectControl<'scalar' | 'vector'>
  size: LabeledNumberControl
  sizeX: LabeledNumberControl
  sizeY: LabeledNumberControl
  sizeZ: LabeledNumberControl
  center: CheckboxControl
  actions: ParameterActionsControl
}

/**
 * The `cube()` primitive. Models OpenSCAD's actual parameters (a size
 * that's a scalar or a per-axis vector, plus `center`) directly as node
 * controls, per AGENTS.md's guidance to avoid forcing separate value
 * nodes for simple literals. Evaluates itself into OpenSCAD via `data()`,
 * which is all `rete-engine`'s `DataflowEngine` requires of a node.
 */
export class CubeNode
  extends ClassicPreset.Node<Record<string, ClassicPreset.Socket>, { geometry: ClassicPreset.Socket }, CubeControls>
  implements DataflowNode
{
  private readonly notify?: () => void
  private size: number | Vector3Params | undefined

  constructor(params: Partial<CubeParams> = {}, notify?: () => void) {
    super('Cube')
    this.notify = notify
    const legacyDefault = notify === undefined && Object.keys(params).length === 0
    this.size = params.size ?? (params.sizeX === undefined ? (legacyDefault ? 10 : undefined) : { x: params.sizeX, y: params.sizeY ?? params.sizeX, z: params.sizeZ ?? params.sizeX })
    if (this.size !== undefined) this.addSize()
    if (params.center !== undefined || legacyDefault) this.addCenter(params.center ?? false)
    this.addControl('actions', new ParameterActionsControl(() => this.actions()))
    this.addOutput('geometry', new ClassicPreset.Output(geometrySocket, 'Geometry'))
  }

  private actions(): readonly { id: string; label: string; run: () => void }[] {
    const actions: { id: string; label: string; run: () => void }[] = []
    if (!this.controls.sizeMode) actions.push({ id: 'add-size', label: '+ Size', run: () => { this.addSize(); this.changed() } })
    if (!this.controls.center) actions.push({ id: 'add-center', label: '+ Center', run: () => { this.addCenter(); this.changed() } })
    if (this.controls.sizeMode) actions.push({ id: 'remove-size', label: '− Size', run: () => this.removeSize() })
    if (this.controls.center) actions.push({ id: 'remove-center', label: '− Center', run: () => this.removeCenter() })
    return actions
  }

  private changed(): void { this.notify?.() }

  private addSize(): void {
    if (this.controls.sizeMode) return
    const vector = typeof this.size === 'object'
    const mode = new SelectControl<'scalar' | 'vector'>('Size', [{ value: 'scalar', label: 'Scalar' }, { value: 'vector', label: 'Vector3' }], vector ? 'vector' : 'scalar')
    mode.onChange = () => { this.updateSizeFields(); this.changed() }
    this.addControl('sizeMode', mode)
    this.addInput('size', new ClassicPreset.Input(numberSocket, 'Size'))
    this.addInput('sizeVector', new ClassicPreset.Input(vector3Socket, 'Size vector'))
    this.addInput('sizeX', new ClassicPreset.Input(numberSocket, 'X'))
    this.addInput('sizeY', new ClassicPreset.Input(numberSocket, 'Y'))
    this.addInput('sizeZ', new ClassicPreset.Input(numberSocket, 'Z'))
    this.updateSizeFields()
  }

  private updateSizeFields(): void {
    for (const key of ['size', 'sizeX', 'sizeY', 'sizeZ'] as const) if (this.controls[key]) this.removeControl(key)
    const literal = this.size
    if (this.controls.sizeMode?.value === 'scalar') {
      this.addControl('size', new LabeledNumberControl('Size', { initial: typeof literal === 'number' ? literal : 10 }))
    } else {
      const vector = typeof literal === 'object' ? literal : { x: 10, y: 10, z: 10 }
      this.addControl('sizeX', new LabeledNumberControl('X', { initial: vector.x }))
      this.addControl('sizeY', new LabeledNumberControl('Y', { initial: vector.y }))
      this.addControl('sizeZ', new LabeledNumberControl('Z', { initial: vector.z }))
    }
  }

  private removeSize(): void {
    for (const key of ['sizeMode', 'size', 'sizeX', 'sizeY', 'sizeZ'] as const) if (this.controls[key]) this.removeControl(key)
    for (const key of ['size', 'sizeVector', 'sizeX', 'sizeY', 'sizeZ']) if (this.inputs[key]) this.removeInput(key)
    this.size = undefined
    this.changed()
  }

  private addCenter(value = false): void { if (!this.controls.center) this.addControl('center', new CheckboxControl('Center', value)) }
  private removeCenter(): void { if (this.controls.center) { this.removeControl('center'); this.changed() } }

  /** Extracts this node's semantic parameters, e.g. for `.scadlet` persistence (see `editor/node-catalog.ts`) - the same values `data()` generates OpenSCAD from. */
  getPersistedParams(): CubeParams {
    const params: CubeParams = {}
    if (this.controls.sizeMode?.value === 'scalar') params.size = this.controls.size?.value ?? 10
    if (this.controls.sizeMode?.value === 'vector') params.size = { x: this.controls.sizeX?.value ?? 10, y: this.controls.sizeY?.value ?? 10, z: this.controls.sizeZ?.value ?? 10 }
    if (this.controls.center) params.center = this.controls.center.value
    return params
  }

  data(inputs: Record<string, (NumberValue | Vector3Value)[] | undefined>): { geometry: GeometryValue } {
    const params = this.getPersistedParams()
    const vector = inputs.sizeVector?.[0]?.code
    const scalar = inputs.size?.[0]?.code
    const x = inputs.sizeX?.[0]?.code
    const y = inputs.sizeY?.[0]?.code
    const z = inputs.sizeZ?.[0]?.code
    if (!vector && !scalar && !x && !y && !z) return { geometry: { code: cubeToOpenSCAD(params) } }
    const size = vector ?? scalar ?? (params.size !== undefined && typeof params.size === 'number' ? String(params.size) : undefined) ?? `[${x ?? this.controls.sizeX?.value ?? 10}, ${y ?? this.controls.sizeY?.value ?? 10}, ${z ?? this.controls.sizeZ?.value ?? 10}]`
    return { geometry: { code: `cube(${size}${params.center ? ', center=true' : ''});` } }
  }
}

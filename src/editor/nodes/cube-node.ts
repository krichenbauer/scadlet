import { ClassicPreset } from 'rete'
import type { DataflowNode } from 'rete-engine'

import { cubeToOpenSCAD, type CubeParams, type CubeSizeRepresentation, type Vector3Params } from '../../openscad/cube'
import { CheckboxControl, LabeledNumberControl, ParameterActionsControl, RepresentationSelectControl, type ParameterAction } from '../controls'
import { geometrySocket, numberSocket, vector3Socket, type GeometryValue, type NumberValue, type Vector3Value } from '../sockets'

type CubeControls = Record<string, ClassicPreset.Control> & {
  sizeMode?: RepresentationSelectControl<CubeSizeRepresentation>
  size?: LabeledNumberControl
  sizeX?: LabeledNumberControl
  sizeY?: LabeledNumberControl
  sizeZ?: LabeledNumberControl
  center?: CheckboxControl
  actions: ParameterActionsControl
}

const SIZE_REPRESENTATIONS: readonly { value: CubeSizeRepresentation; label: string }[] = [
  { value: 'scalar', label: 'Scalar' },
  { value: 'xyz', label: 'XYZ' },
  { value: 'vector', label: 'Vector' },
]

/** Cube has one semantic `size` argument. Scalar, XYZ, and Vector are
 * alternative editor/input representations; inactive representations have
 * neither a Rete input nor a rendered socket, so they cannot hide live graph
 * semantics. */
export class CubeNode extends ClassicPreset.Node<Record<string, ClassicPreset.Socket>, { geometry: ClassicPreset.Socket }, CubeControls> implements DataflowNode {
  private readonly notify?: () => void
  private representation: CubeSizeRepresentation | undefined
  private scalarLiteral: number
  private xyzLiteral: Vector3Params

  constructor(params: Partial<CubeParams> = {}, notify?: () => void) {
    super('Cube')
    this.notify = notify
    const legacyDefault = notify === undefined && Object.keys(params).length === 0
    const legacyVector = params.sizeX === undefined ? undefined : { x: params.sizeX, y: params.sizeY ?? params.sizeX, z: params.sizeZ ?? params.sizeX }
    const initialSize = params.size ?? legacyVector
    this.scalarLiteral = params.sizeScalar ?? (typeof initialSize === 'number' ? initialSize : 10)
    this.xyzLiteral = params.sizeVector ?? (typeof initialSize === 'object' && initialSize !== null ? initialSize : { x: 10, y: 10, z: 10 })
    this.representation = params.sizeRepresentation ?? (initialSize === undefined ? (legacyDefault ? 'scalar' : undefined) : typeof initialSize === 'number' ? 'scalar' : 'xyz')
    if (this.representation) this.addSize(this.representation)
    if (params.center !== undefined || legacyDefault) this.addCenter(params.center ?? false)
    this.addControl('actions', new ParameterActionsControl(() => this.actions()))
    this.addOutput('geometry', new ClassicPreset.Output(geometrySocket, 'Geometry'))
  }

  private changed(): void { this.notify?.() }

  private actions(): readonly ParameterAction[] {
    const actions: ParameterAction[] = []
    if (!this.representation) {
      actions.push({
        id: 'add-size', label: '+ Size', children: SIZE_REPRESENTATIONS.map(({ value, label }) => ({
          id: `add-size-${value}`, label, run: () => { this.addSize(value); this.changed() },
        })),
      })
    }
    if (!this.controls.center) actions.push({ id: 'add-center', label: '+ Center', run: () => { this.addCenter(false); this.changed() } })
    if (this.representation) actions.push({ id: 'remove-size', label: '− Size', run: () => this.removeSize() })
    if (this.controls.center) actions.push({ id: 'remove-center', label: '− Center', run: () => this.removeCenter() })
    return actions
  }

  private addSize(representation: CubeSizeRepresentation): void {
    this.representation = representation
    const mode = new RepresentationSelectControl('size', 'Size', SIZE_REPRESENTATIONS, representation)
    mode.onChange = (next) => this.switchRepresentation(next)
    this.addControl('sizeMode', mode)
    this.addActiveRepresentation(representation)
  }

  /** Captures the outgoing literal before replacing only its active controls
   * and ports. The editor prevents UI switches that would hide connections. */
  private switchRepresentation(next: CubeSizeRepresentation): void {
    if (!this.representation || next === this.representation) return
    this.captureActiveLiteral()
    this.removeActiveRepresentation()
    this.representation = next
    this.addActiveRepresentation(next)
    this.changed()
  }

  private addActiveRepresentation(representation: CubeSizeRepresentation): void {
    if (representation === 'scalar') {
      this.addInput('size', new ClassicPreset.Input(numberSocket, 'Size'))
      this.addControl('size', new LabeledNumberControl('Size', { initial: this.scalarLiteral, change: (value) => { this.scalarLiteral = value } }))
    } else if (representation === 'xyz') {
      for (const [key, label, value] of [['sizeX', 'X', this.xyzLiteral.x], ['sizeY', 'Y', this.xyzLiteral.y], ['sizeZ', 'Z', this.xyzLiteral.z]] as const) {
        this.addInput(key, new ClassicPreset.Input(numberSocket, label))
        this.addControl(key, new LabeledNumberControl(label, { initial: value, change: (next) => { this.xyzLiteral = { ...this.xyzLiteral, [key === 'sizeX' ? 'x' : key === 'sizeY' ? 'y' : 'z']: next } } }))
      }
    } else {
      this.addInput('sizeVector', new ClassicPreset.Input(vector3Socket, 'Vector3'))
    }
  }

  private captureActiveLiteral(): void {
    if (this.representation === 'scalar') this.scalarLiteral = this.controls.size?.value ?? this.scalarLiteral
    if (this.representation === 'xyz') {
      this.xyzLiteral = {
        x: this.controls.sizeX?.value ?? this.xyzLiteral.x,
        y: this.controls.sizeY?.value ?? this.xyzLiteral.y,
        z: this.controls.sizeZ?.value ?? this.xyzLiteral.z,
      }
    }
  }

  private removeActiveRepresentation(): void {
    for (const key of ['size', 'sizeX', 'sizeY', 'sizeZ', 'sizeVector']) {
      if (this.inputs[key]) this.removeInput(key)
      if (this.controls[key]) this.removeControl(key)
    }
  }

  private removeSize(): void {
    this.captureActiveLiteral()
    this.removeActiveRepresentation()
    if (this.controls.sizeMode) this.removeControl('sizeMode')
    this.representation = undefined
    this.changed()
  }

  private addCenter(value: boolean): void { if (!this.controls.center) this.addControl('center', new CheckboxControl('Center', value)) }
  private removeCenter(): void { if (this.controls.center) { this.removeControl('center'); this.changed() } }

  getPersistedParams(): CubeParams {
    const params: CubeParams = {}
    if (this.representation) {
      this.captureActiveLiteral()
      params.sizeRepresentation = this.representation
      params.sizeScalar = this.scalarLiteral
      params.sizeVector = { ...this.xyzLiteral }
      if (this.representation === 'scalar') params.size = this.scalarLiteral
      if (this.representation === 'xyz') params.size = { ...this.xyzLiteral }
    }
    if (this.controls.center) params.center = this.controls.center.value
    return params
  }

  data(inputs: Record<string, (NumberValue | Vector3Value)[] | undefined>): { geometry: GeometryValue } {
    const params = this.getPersistedParams()
    if (this.representation === 'vector') {
      const vector = inputs.sizeVector?.[0]?.code
      return { geometry: { code: vector ? `cube(${vector}${params.center ? ', center=true' : ''});` : cubeToOpenSCAD(params) } }
    }
    if (this.representation === 'scalar') {
      const size = inputs.size?.[0]?.code
      return { geometry: { code: size ? `cube(${size}${params.center ? ', center=true' : ''});` : cubeToOpenSCAD(params) } }
    }
    if (this.representation === 'xyz') {
      const x = inputs.sizeX?.[0]?.code ?? String(this.xyzLiteral.x)
      const y = inputs.sizeY?.[0]?.code ?? String(this.xyzLiteral.y)
      const z = inputs.sizeZ?.[0]?.code ?? String(this.xyzLiteral.z)
      if (inputs.sizeX?.[0] || inputs.sizeY?.[0] || inputs.sizeZ?.[0]) return { geometry: { code: `cube([${x}, ${y}, ${z}]${params.center ? ', center=true' : ''});` } }
    }
    return { geometry: { code: cubeToOpenSCAD(params) } }
  }
}

import { ClassicPreset } from 'rete'
import type { DataflowNode } from 'rete-engine'

import { cubeToOpenSCAD, type CubeParams, type CubeSizeRepresentation, type Vector3Params } from '../../openscad/cube'
import { t } from '../../i18n/translate'
import { CheckboxControl, LabeledNumberControl, ParameterActionsControl, type ParameterAction, type RemovableRow } from '../controls'
import { booleanSocket, geometrySocket, numberSocket, vector3Socket, type BooleanValue, type GeometryValue, type NumberValue, type Vector3Value } from '../sockets'

type CubeControls = Record<string, ClassicPreset.Control> & {
  size?: LabeledNumberControl
  sizeX?: LabeledNumberControl
  sizeY?: LabeledNumberControl
  sizeZ?: LabeledNumberControl
  center?: CheckboxControl
  actions: ParameterActionsControl
}

const SIZE_REPRESENTATIONS: readonly { value: CubeSizeRepresentation; label: string }[] = [
  { value: 'scalar', label: t('mode.scalar') },
  { value: 'xyz', label: t('mode.xyz') },
  { value: 'vector', label: t('mode.vector') },
]

/** Cube has one semantic `size` argument. Scalar, XYZ, and Vector are
 * alternative editor/input representations - concrete forms chosen through
 * the header Add menu, never a mode dropdown (node-style.md "Add
 * parameter"). Inactive representations have neither a Rete input nor a
 * rendered socket, so they cannot hide live graph semantics. */
export class CubeNode extends ClassicPreset.Node<Record<string, ClassicPreset.Socket>, { geometry: ClassicPreset.Socket }, CubeControls> implements DataflowNode {
  private readonly notify?: () => void
  private readonly requestRemoveForm?: (keys: readonly string[], label: string) => Promise<boolean>
  private representation: CubeSizeRepresentation | undefined
  private scalarLiteral: number
  private xyzLiteral: Vector3Params

  constructor(params: Partial<CubeParams> = {}, notify?: () => void, requestRemoveForm?: (keys: readonly string[], label: string) => Promise<boolean>) {
    super(t('node.cube'))
    this.notify = notify
    this.requestRemoveForm = requestRemoveForm
    const legacyDefault = notify === undefined && Object.keys(params).length === 0
    const legacyVector = params.sizeX === undefined ? undefined : { x: params.sizeX, y: params.sizeY ?? params.sizeX, z: params.sizeZ ?? params.sizeX }
    const initialSize = params.size ?? legacyVector
    this.scalarLiteral = params.sizeScalar ?? (typeof initialSize === 'number' ? initialSize : 10)
    this.xyzLiteral = params.sizeVector ?? (typeof initialSize === 'object' && initialSize !== null ? initialSize : { x: 10, y: 10, z: 10 })
    this.representation = params.sizeRepresentation ?? (initialSize === undefined ? (legacyDefault ? 'scalar' : undefined) : typeof initialSize === 'number' ? 'scalar' : 'xyz')
    if (this.representation) this.addActiveRepresentation(this.representation)
    if (params.center !== undefined || legacyDefault) this.addCenter(params.center ?? false)
    this.addControl('actions', new ParameterActionsControl(() => this.actions()))
    this.addOutput('geometry', new ClassicPreset.Output(geometrySocket, t('input.geometry')))
  }

  private changed(): void { this.notify?.() }

  /** Header Add menu entries - only forms/categories not currently present. */
  private actions(): readonly ParameterAction[] {
    const actions: ParameterAction[] = []
    if (!this.representation) {
      actions.push({
        id: 'add-size', label: t('control.size'), children: SIZE_REPRESENTATIONS.map(({ value, label }) => ({
          id: `add-size-${value}`, label, run: () => { this.addActiveRepresentation(value); this.representation = value; this.changed() },
        })),
      })
    }
    if (!this.controls.center) actions.push({ id: 'add-center', label: t('control.center'), run: () => { this.addCenter(false); this.changed() } })
    return actions
  }

  /** Row-level Remove buttons: one designated row per removable form. */
  removableRows(): readonly RemovableRow[] {
    const rows: RemovableRow[] = []
    const activeKeys = this.activeInputKeys()
    if (activeKeys.length > 0) rows.push({ key: activeKeys[0]!, label: t('control.size'), requestRemove: () => this.requestRemoveSize() })
    if (this.controls.center) rows.push({ key: 'center', label: t('control.center'), requestRemove: () => this.requestRemoveCenter() })
    return rows
  }

  private addActiveRepresentation(representation: CubeSizeRepresentation): void {
    if (representation === 'scalar') {
      this.addInput('size', new ClassicPreset.Input(numberSocket, t('control.size')))
      this.addControl('size', new LabeledNumberControl(t('control.size'), { initial: this.scalarLiteral, change: (value) => { this.scalarLiteral = value } }))
    } else if (representation === 'xyz') {
      for (const [key, label, value] of [['sizeX', t('control.x'), this.xyzLiteral.x], ['sizeY', t('control.y'), this.xyzLiteral.y], ['sizeZ', t('control.z'), this.xyzLiteral.z]] as const) {
        this.addInput(key, new ClassicPreset.Input(numberSocket, label))
        this.addControl(key, new LabeledNumberControl(label, { initial: value, change: (next) => { this.xyzLiteral = { ...this.xyzLiteral, [key === 'sizeX' ? 'x' : key === 'sizeY' ? 'y' : 'z']: next } } }))
      }
    } else {
      this.addInput('sizeVector', new ClassicPreset.Input(vector3Socket, t('mode.vector')))
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

  private removeActiveRepresentationPorts(): void {
    for (const key of ['size', 'sizeX', 'sizeY', 'sizeZ', 'sizeVector']) {
      if (this.inputs[key]) this.removeInput(key)
      if (this.controls[key]) this.removeControl(key)
    }
  }

  private activeInputKeys(): string[] {
    return ['size', 'sizeX', 'sizeY', 'sizeZ', 'sizeVector'].filter((key) => Boolean(this.inputs[key]))
  }

  /** Confirm-gated (established concise warning flow) if any active input is
   * connected, then removes the whole active Size form. */
  private async requestRemoveSize(): Promise<boolean> {
    const keys = this.activeInputKeys()
    if (keys.length === 0) return false
    if (!(await (this.requestRemoveForm?.(keys, t('control.size')) ?? Promise.resolve(true)))) return false
    this.captureActiveLiteral()
    this.removeActiveRepresentationPorts()
    this.representation = undefined
    this.changed()
    return true
  }

  private addCenter(value: boolean): void {
    if (this.controls.center) return
    this.addInput('center', new ClassicPreset.Input(booleanSocket, t('control.center')))
    this.addControl('center', new CheckboxControl(t('control.center'), value))
  }

  private async requestRemoveCenter(): Promise<boolean> {
    if (!this.controls.center) return false
    if (!(await (this.requestRemoveForm?.(['center'], t('control.center')) ?? Promise.resolve(true)))) return false
    this.removeControl('center')
    this.removeInput('center')
    this.changed()
    return true
  }

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

  data(inputs: Record<string, (NumberValue | Vector3Value | BooleanValue)[] | undefined>): { geometry: GeometryValue } {
    const params = this.getPersistedParams()
    const center = inputs.center?.[0]?.code
    const centerArgument = center ?? (params.center ? 'true' : undefined)
    const fallback = (): string => {
      if (!center) return cubeToOpenSCAD(params)
      if (params.size === undefined) return `cube(center=${center});`
      const size = typeof params.size === 'number'
        ? String(params.size)
        : `[${params.size.x}, ${params.size.y}, ${params.size.z}]`
      return `cube(${size}, center=${center});`
    }
    if (this.representation === 'vector') {
      const vector = inputs.sizeVector?.[0]?.code
      return { geometry: { code: vector ? `cube(${vector}${centerArgument ? `, center=${centerArgument}` : ''});` : fallback() } }
    }
    if (this.representation === 'scalar') {
      const size = inputs.size?.[0]?.code
      return { geometry: { code: size ? `cube(${size}${centerArgument ? `, center=${centerArgument}` : ''});` : fallback() } }
    }
    if (this.representation === 'xyz') {
      const x = inputs.sizeX?.[0]?.code ?? String(this.xyzLiteral.x)
      const y = inputs.sizeY?.[0]?.code ?? String(this.xyzLiteral.y)
      const z = inputs.sizeZ?.[0]?.code ?? String(this.xyzLiteral.z)
      if (inputs.sizeX?.[0] || inputs.sizeY?.[0] || inputs.sizeZ?.[0] || center) return { geometry: { code: `cube([${x}, ${y}, ${z}]${centerArgument ? `, center=${centerArgument}` : ''});` } }
    }
    return { geometry: { code: fallback() } }
  }
}

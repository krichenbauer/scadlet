import { ClassicPreset } from 'rete'
import type { DataflowNode } from 'rete-engine'

import { t } from '../../i18n/translate'
import { ModuleGeometryInputAddControl, ModuleGeometryInputEditControl, ModuleParameterAddControl, ModuleParameterEditControl, ParameterActionsControl, type ParameterAction, type RemovableRow } from '../controls'
import { booleanSocket, geometrySocket, numberSocket, vector3Socket, type BooleanValue, type GeometryValue, type NumberValue, type Vector3Value } from '../sockets'
import { moduleGeometryInputPortId, moduleParameterPortId, type ModuleGeometryInput, type ModuleParameter } from '../definitions'

/** The fixed parameter interface of a Module definition. Phase 1 has no
 * parameters yet, but the node is a real, stable part of that definition's
 * graph rather than a decorative frame label. */
export class ModuleInputsNode extends ClassicPreset.Node<Record<string, never>, Record<string, ClassicPreset.Socket>, { addParameter: ModuleParameterAddControl; editParameter: ModuleParameterEditControl; addGeometryInput: ModuleGeometryInputAddControl; editGeometryInput: ModuleGeometryInputEditControl; addActions: ParameterActionsControl }> implements DataflowNode {
  private parameters: readonly ModuleParameter[]
  private geometryInputs: readonly ModuleGeometryInput[]
  constructor(parameters: readonly ModuleParameter[] = [], geometryInputs: readonly ModuleGeometryInput[] = []) {
    super(t('node.moduleInputs'))
    this.parameters = parameters
    this.geometryInputs = geometryInputs
    this.materializeOutputs()
    this.addControl('addGeometryInput', new ModuleGeometryInputAddControl(() => {}, () => {}))
    this.addControl('editGeometryInput', new ModuleGeometryInputEditControl(() => {}, () => {}))
    this.addControl('addParameter', new ModuleParameterAddControl(
      () => {},
      () => {},
    ))
    this.addControl('editParameter', new ModuleParameterEditControl(() => {}, () => {}))
    // Both interface item categories are always addable (repeatable) - the
    // header Add menu is never hidden or disabled for Module Inputs.
    this.addControl('addActions', new ParameterActionsControl(() => this.addActionsList()))
  }

  private addActionsList(): readonly ParameterAction[] {
    return [
      { id: 'add-geometry-input', label: t('definition.addGeometryInput'), run: () => this.controls.addGeometryInput.show() },
      { id: 'add-parameter', label: t('definition.addParameter'), run: () => this.controls.addParameter.show() },
    ]
  }

  /** Row-level Remove buttons, reusing the same confirm-gated delete
   * lifecycle already wired through `configureGeometryInputEditing`/
   * `configureParameterEditing`'s `onDelete` - no parallel mutation path.
   * A thrown failure (e.g. a broken confirmation) is surfaced through the
   * same edit control's `error`/`onChange`, since neither control renders
   * its own row-level UI otherwise. */
  removableRows(): readonly RemovableRow[] {
    return [
      ...this.geometryInputs.map((input): RemovableRow => ({
        key: moduleGeometryInputPortId(input.id), label: input.name,
        requestRemove: async () => {
          const control = this.controls.editGeometryInput
          control.error = null
          try {
            return await Promise.resolve(control.onDelete(input.id))
          } catch (error) {
            control.error = error instanceof Error ? error.message : String(error)
            control.onChange()
            return false
          }
        },
      })),
      ...this.parameters.map((parameter): RemovableRow => ({
        key: moduleParameterPortId(parameter.id), label: parameter.name,
        requestRemove: async () => {
          const control = this.controls.editParameter
          control.error = null
          try {
            return await Promise.resolve(control.onDelete(parameter.id))
          } catch (error) {
            control.error = error instanceof Error ? error.message : String(error)
            control.onChange()
            return false
          }
        },
      })),
    ]
  }

  configureGeometryInputEditing(onChange: () => void, onAdd: (name: string) => boolean | void | Promise<boolean | void>, onSubmit: (id: string, name: string) => boolean | void | Promise<boolean | void>, onDelete: (id: string) => boolean | Promise<boolean>, onMove: (id: string, direction: -1 | 1) => boolean | void | Promise<boolean | void>): void {
    const add = this.controls.addGeometryInput; add.onChange = onChange; add.onSubmit = onAdd
    const edit = this.controls.editGeometryInput; edit.onChange = onChange; edit.onSubmit = (name) => edit.inputId ? onSubmit(edit.inputId, name) : false; edit.onDelete = onDelete; edit.onMove = onMove
  }

  beginGeometryInputEdit(id: string): void {
    const index = this.geometryInputs.findIndex((input) => input.id === id)
    if (index >= 0) this.controls.editGeometryInput.openInput(this.geometryInputs[index]!, index)
  }

  configureParameterEditing(onChange: () => void, onSubmit: (id: string, value: { name: string; type: 'number' | 'boolean' | 'vector3'; default: number | boolean | [number, number, number] }) => boolean | void | Promise<boolean | void>, onDelete: (id: string) => boolean | Promise<boolean>, onMove: (id: string, direction: -1 | 1) => void | Promise<void>): void {
    const control = this.controls.editParameter
    control.onChange = onChange
    control.onSubmit = (value) => control.parameterId ? onSubmit(control.parameterId, value) : undefined
    control.onDelete = onDelete; control.onMove = onMove
  }

  beginParameterEdit(id: string): void {
    const index = this.parameters.findIndex((parameter) => parameter.id === id)
    if (index >= 0) this.controls.editParameter.openParameter(this.parameters[index], index)
  }

  configureParameterCreation(onChange: () => void, onSubmit: (value: { name: string; type: 'number' | 'boolean' | 'vector3'; default: number | boolean | [number, number, number] }) => void | Promise<void>): void {
    const control = this.controls.addParameter
    control.onChange = onChange
    control.onSubmit = onSubmit
  }

  syncSignature(parameters: readonly ModuleParameter[], geometryInputs: readonly ModuleGeometryInput[] = this.geometryInputs): void {
    const next = new Map(parameters.map((parameter) => [moduleParameterPortId(parameter.id), parameter]))
    const nextGeometry = new Map(geometryInputs.map((input) => [moduleGeometryInputPortId(input.id), input]))
    for (const key of Object.keys(this.outputs)) {
      if (key.startsWith('geometry:')) {
        if (!nextGeometry.has(key)) this.removeOutput(key)
        continue
      }
      if (!next.has(key)) this.removeOutput(key)
      else if (this.outputs[key]?.socket.name !== socketName(next.get(key)!)) {
        this.removeOutput(key)
      }
    }
    this.parameters = parameters
    this.geometryInputs = geometryInputs
    this.materializeOutputs()
    for (const input of geometryInputs) {
      const output = this.outputs[moduleGeometryInputPortId(input.id)]
      if (output) output.label = input.name
    }
    for (const parameter of parameters) {
      const output = this.outputs[moduleParameterPortId(parameter.id)]
      if (output) output.label = parameter.name
    }
  }

  private materializeOutputs(): void {
    for (const input of this.geometryInputs) {
      const key = moduleGeometryInputPortId(input.id)
      if (!this.outputs[key]) this.addOutput(key, new ClassicPreset.Output(geometrySocket, input.name))
    }
    for (const parameter of this.parameters) {
      const socket = parameter.type === 'number' ? numberSocket : parameter.type === 'boolean' ? booleanSocket : vector3Socket
      const key = moduleParameterPortId(parameter.id)
      if (!this.outputs[key]) this.addOutput(key, new ClassicPreset.Output(socket, parameter.name))
    }
  }

  data(): Record<string, GeometryValue | NumberValue | BooleanValue | Vector3Value> {
    return {
      ...Object.fromEntries(this.geometryInputs.map((input, index) => [moduleGeometryInputPortId(input.id), { code: `children(${index});` }])),
      ...Object.fromEntries(this.parameters.map((parameter) => [moduleParameterPortId(parameter.id), { code: parameter.name }])),
    }
  }
}

function socketName(parameter: ModuleParameter): string { return parameter.type }

/** SCADlet's explicit Geometry body root for a Module definition. It is a
 * sink, not an OpenSCAD return statement, and intentionally has no output. */
export class ModuleOutputNode extends ClassicPreset.Node<{ geometry: ClassicPreset.Socket }> implements DataflowNode {
  constructor() {
    super(t('node.moduleOutput'))
    this.addInput('geometry', new ClassicPreset.Input(geometrySocket, t('input.geometry')))
  }

  data(): Record<string, never> { return {} }
}

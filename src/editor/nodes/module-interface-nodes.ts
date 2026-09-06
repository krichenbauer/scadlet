import { ClassicPreset } from 'rete'
import type { DataflowNode } from 'rete-engine'

import { t } from '../../i18n/translate'
import { ModuleParameterAddControl, ModuleParameterEditControl } from '../controls'
import { booleanSocket, geometrySocket, numberSocket, vector3Socket, type BooleanValue, type GeometryValue, type NumberValue, type Vector3Value } from '../sockets'
import { MODULE_CHILD_PORT_ID, moduleParameterPortId, type ModuleParameter } from '../definitions'

/** The fixed parameter interface of a Module definition. Phase 1 has no
 * parameters yet, but the node is a real, stable part of that definition's
 * graph rather than a decorative frame label. */
export class ModuleInputsNode extends ClassicPreset.Node<Record<string, never>, Record<string, ClassicPreset.Socket>, { addParameter: ModuleParameterAddControl; editParameter: ModuleParameterEditControl }> implements DataflowNode {
  private parameters: readonly ModuleParameter[]
  constructor(parameters: readonly ModuleParameter[] = []) {
    super(t('node.moduleInputs'))
    this.parameters = parameters
    this.addOutput(MODULE_CHILD_PORT_ID, new ClassicPreset.Output(geometrySocket, t('input.children')))
    this.materializeOutputs()
    this.addControl('addParameter', new ModuleParameterAddControl(
      () => {},
      () => {},
    ))
    this.addControl('editParameter', new ModuleParameterEditControl(() => {}, () => {}))
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

  syncSignature(parameters: readonly ModuleParameter[]): void {
    const next = new Map(parameters.map((parameter) => [moduleParameterPortId(parameter.id), parameter]))
    for (const key of Object.keys(this.outputs)) {
      if (key === MODULE_CHILD_PORT_ID) continue
      if (!next.has(key)) this.removeOutput(key)
      else if (this.outputs[key]?.socket.name !== socketName(next.get(key)!)) {
        this.removeOutput(key)
      }
    }
    this.parameters = parameters
    this.materializeOutputs()
    for (const parameter of parameters) {
      const output = this.outputs[moduleParameterPortId(parameter.id)]
      if (output) output.label = parameter.name
    }
  }

  private materializeOutputs(): void {
    for (const parameter of this.parameters) {
      const socket = parameter.type === 'number' ? numberSocket : parameter.type === 'boolean' ? booleanSocket : vector3Socket
      const key = moduleParameterPortId(parameter.id)
      if (!this.outputs[key]) this.addOutput(key, new ClassicPreset.Output(socket, parameter.name))
    }
  }

  data(): Record<string, GeometryValue | NumberValue | BooleanValue | Vector3Value> {
    return {
      [MODULE_CHILD_PORT_ID]: { code: 'children()' },
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

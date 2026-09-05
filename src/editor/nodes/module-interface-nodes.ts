import { ClassicPreset } from 'rete'
import type { DataflowNode } from 'rete-engine'

import { t } from '../../i18n/translate'
import { ModuleParameterAddControl } from '../controls'
import { booleanSocket, geometrySocket, numberSocket, vector3Socket, type BooleanValue, type NumberValue, type Vector3Value } from '../sockets'
import { moduleParameterPortId, type ModuleParameter } from '../definitions'

/** The fixed parameter interface of a Module definition. Phase 1 has no
 * parameters yet, but the node is a real, stable part of that definition's
 * graph rather than a decorative frame label. */
export class ModuleInputsNode extends ClassicPreset.Node<Record<string, never>, Record<string, ClassicPreset.Socket>, { addParameter: ModuleParameterAddControl }> implements DataflowNode {
  private parameters: readonly ModuleParameter[]
  constructor(parameters: readonly ModuleParameter[] = []) {
    super(t('node.moduleInputs'))
    this.parameters = parameters
    this.materializeOutputs()
    this.addControl('addParameter', new ModuleParameterAddControl(
      () => {},
      () => {},
    ))
  }

  configureParameterCreation(onChange: () => void, onSubmit: (value: { name: string; type: 'number' | 'boolean' | 'vector3'; default: number | boolean | [number, number, number] }) => void | Promise<void>): void {
    const control = this.controls.addParameter
    control.onChange = onChange
    control.onSubmit = onSubmit
  }

  syncSignature(parameters: readonly ModuleParameter[]): void {
    this.parameters = parameters
    this.materializeOutputs()
  }

  private materializeOutputs(): void {
    for (const parameter of this.parameters) {
      const socket = parameter.type === 'number' ? numberSocket : parameter.type === 'boolean' ? booleanSocket : vector3Socket
      const key = moduleParameterPortId(parameter.id)
      if (!this.outputs[key]) this.addOutput(key, new ClassicPreset.Output(socket, parameter.name))
    }
  }

  data(): Record<string, NumberValue | BooleanValue | Vector3Value> {
    return Object.fromEntries(this.parameters.map((parameter) => [moduleParameterPortId(parameter.id), { code: parameter.name }]))
  }
}

/** SCADlet's explicit Geometry body root for a Module definition. It is a
 * sink, not an OpenSCAD return statement, and intentionally has no output. */
export class ModuleOutputNode extends ClassicPreset.Node<{ geometry: ClassicPreset.Socket }> implements DataflowNode {
  constructor() {
    super(t('node.moduleOutput'))
    this.addInput('geometry', new ClassicPreset.Input(geometrySocket, t('input.geometry')))
  }

  data(): Record<string, never> { return {} }
}

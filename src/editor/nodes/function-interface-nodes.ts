import { ClassicPreset } from 'rete'
import type { DataflowNode } from 'rete-engine'

import { t } from '../../i18n/translate'
import { ModuleParameterAddControl, ModuleParameterEditControl } from '../controls'
import { booleanSocket, numberSocket, unresolvedSocket, vector3Socket, type BooleanValue, type NumberValue, type Vector3Value } from '../sockets'
import { moduleParameterPortId, type FunctionResultType, type ModuleParameter } from '../definitions'

/** The parameter interface of a Function definition. It intentionally has
 * no Geometry inputs and reuses the exact same stable-id/add/edit
 * infrastructure as `ModuleInputsNode`'s value parameters - Functions and
 * Modules share one signature model, they just expose it differently. */
export class FunctionInputsNode extends ClassicPreset.Node<Record<string, never>, Record<string, ClassicPreset.Socket>, { addParameter: ModuleParameterAddControl; editParameter: ModuleParameterEditControl }> implements DataflowNode {
  private parameters: readonly ModuleParameter[]
  constructor(parameters: readonly ModuleParameter[] = []) {
    super(t('node.functionInputs'))
    this.parameters = parameters
    this.materializeOutputs()
    this.addControl('addParameter', new ModuleParameterAddControl(() => {}, () => {}))
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
      if (!next.has(key) || this.outputs[key]?.socket.name !== socketName(next.get(key)!)) this.removeOutput(key)
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
      const key = moduleParameterPortId(parameter.id)
      if (!this.outputs[key]) this.addOutput(key, new ClassicPreset.Output(socketName(parameter) === 'number' ? numberSocket : socketName(parameter) === 'boolean' ? booleanSocket : vector3Socket, parameter.name))
    }
  }

  data(): Record<string, NumberValue | BooleanValue | Vector3Value> {
    return Object.fromEntries(this.parameters.map((parameter) => [moduleParameterPortId(parameter.id), { code: parameter.name }]))
  }
}

function socketName(parameter: ModuleParameter): string { return parameter.type }

/** SCADlet's explicit single-expression sink for a Function definition. Its
 * one input starts as a neutral/grey `unresolvedSocket`; connecting a
 * Number/Boolean/Vector3 expression resolves the Function's result type and
 * swaps this port for the matching real typed socket (see `editor.ts`'s
 * Function result-connection handling). This is not an OpenSCAD `return`
 * statement - the connected expression becomes the Function's body. */
export class FunctionOutputNode extends ClassicPreset.Node<{ result: ClassicPreset.Socket }> implements DataflowNode {
  constructor(resultType?: FunctionResultType) {
    super(t('node.functionOutput'))
    // Rete sees this as multi-connectable so ClassicFlow does not eagerly
    // delete the occupied result wire before SCADlet's controlled
    // replace/confirm transaction runs. Persistence/live semantics still
    // enforce exactly one result; editor.ts removes the prior wire itself.
    this.addInput('result', new ClassicPreset.Input(socketForType(resultType), t('input.functionResult'), true))
  }

  setResultType(resultType: FunctionResultType | undefined): void {
    const input = this.inputs.result
    if (input) input.socket = socketForType(resultType)
    else this.addInput('result', new ClassicPreset.Input(socketForType(resultType), t('input.functionResult'), true))
  }

  data(): Record<string, never> { return {} }
}

export function socketForType(type: FunctionResultType | undefined): ClassicPreset.Socket {
  return type === 'number' ? numberSocket : type === 'boolean' ? booleanSocket : type === 'vector3' ? vector3Socket : unresolvedSocket
}

import { ClassicPreset } from 'rete'
import type { DataflowNode } from 'rete-engine'

import { booleanSocket, numberSocket, vector3Socket, type BooleanValue, type NumberValue, type Vector3Value } from '../sockets'
import { t } from '../../i18n/translate'
import { CheckboxControl, LabeledNumberControl, Vector3Control } from '../controls'
import { moduleParameterPortId, type FunctionResultType, type ModuleDefinition, type ModuleParameter, type ModuleParameterDefault } from '../definitions'
import { socketForType } from './function-interface-nodes'

// Re-exported so callers that only know about Function Calls don't also
// need to import from `function-interface-nodes.ts` directly.
export { socketForType } from './function-interface-nodes'

/** A project-defined Function use. Its stable definition ID is the semantic
 * reference, exactly like `ModuleCallNode` - it just produces one typed
 * value instead of Geometry. New Calls are only created for resolved
 * Functions; an existing Call may be reconstructed with an unresolved output
 * after its Function result is disconnected (see the lifecycle rules in
 * AGENTS.md). */
export interface FunctionCallParams { definitionId: string; arguments?: Record<string, ModuleParameterDefault> }

export class FunctionCallNode extends ClassicPreset.Node<Record<string, ClassicPreset.Socket>, { value: ClassicPreset.Socket }, Record<string, LabeledNumberControl | CheckboxControl | Vector3Control>> implements DataflowNode {
  readonly definitionId: string
  private functionName: string
  private parameters: readonly ModuleParameter[]
  private resultType: FunctionResultType | undefined
  private readonly onControlsChanged?: (nodeId: string) => void

  constructor(
    definition: Pick<ModuleDefinition, 'id' | 'name' | 'parameters' | 'resultType'>,
    params: FunctionCallParams,
    onControlsChanged?: (nodeId: string) => void,
  ) {
    super(definition.name)
    this.definitionId = definition.id
    this.functionName = definition.name
    this.parameters = definition.parameters ?? []
    this.resultType = definition.resultType
    this.onControlsChanged = onControlsChanged
    this.materializeInputs(params.arguments ?? {})
    this.addOutput('value', new ClassicPreset.Output(socketForType(this.resultType), t('control.value')))
  }

  syncSignature(
    parameters: readonly ModuleParameter[],
    resetFallbackIds: ReadonlySet<string> = new Set(),
    fallbackOverrides: Readonly<Record<string, ModuleParameterDefault>> = {},
  ): void {
    const fallbacks = { ...this.getArguments(), ...fallbackOverrides }
    for (const id of resetFallbackIds) delete fallbacks[id]
    const next = new Map(parameters.map((parameter) => [moduleParameterPortId(parameter.id), parameter]))
    for (const key of Object.keys(this.inputs)) {
      const parameter = next.get(key)
      if (!parameter || this.inputs[key]?.socket.name !== parameter.type) {
        this.removeInput(key)
        this.removeControl(key)
      }
    }
    this.parameters = parameters
    this.materializeInputs(fallbacks)
    for (const parameter of parameters) {
      const input = this.inputs[moduleParameterPortId(parameter.id)]
      if (input) input.label = parameter.name
    }
    this.onControlsChanged?.(this.id)
  }

  syncDefinitionName(name: string): void {
    this.functionName = name
    this.label = name
    this.onControlsChanged?.(this.id)
  }

  /** Mirrors `FunctionOutputNode.setResultType`: the same port key is kept
   * so any existing connection reference stays attached-by-key while the
   * underlying socket instance is swapped for the new (or neutral/
   * unresolved) type. */
  setResultType(resultType: FunctionResultType | undefined): void {
    this.resultType = resultType
    const output = this.outputs.value
    if (output) output.socket = socketForType(resultType)
    else this.addOutput('value', new ClassicPreset.Output(socketForType(resultType), t('control.value')))
    this.onControlsChanged?.(this.id)
  }

  private materializeInputs(argumentsById: Record<string, ModuleParameterDefault>): void {
    for (const parameter of this.parameters) {
      const key = moduleParameterPortId(parameter.id)
      const socket = parameter.type === 'number' ? numberSocket : parameter.type === 'boolean' ? booleanSocket : vector3Socket
      if (this.inputs[key]) continue
      this.addInput(key, new ClassicPreset.Input(socket, parameter.name))
      const fallback = argumentsById[parameter.id] ?? parameter.default
      if (parameter.type === 'number') this.addControl(key, new LabeledNumberControl(parameter.name, { initial: fallback as number }))
      else if (parameter.type === 'boolean') this.addControl(key, new CheckboxControl(parameter.name, fallback as boolean))
      else this.addControl(key, new Vector3Control(parameter.name, fallback as [number, number, number]))
    }
  }

  getArguments(): Record<string, ModuleParameterDefault> {
    return Object.fromEntries(this.parameters.map((parameter) => {
      const value = this.controls[moduleParameterPortId(parameter.id)]
      return [parameter.id, value instanceof LabeledNumberControl ? value.value ?? 0 : value instanceof CheckboxControl ? value.value : value instanceof Vector3Control ? value.value : parameter.default]
    }))
  }

  getPersistedParams(): FunctionCallParams { return { definitionId: this.definitionId, arguments: this.getArguments() } }

  data(inputs: Record<string, (NumberValue | BooleanValue | Vector3Value)[] | undefined>): { value: NumberValue | BooleanValue | Vector3Value } {
    const argumentsSource = this.parameters.map((parameter) => {
      const key = moduleParameterPortId(parameter.id)
      const connected = inputs[key]?.[0]?.code
      const fallback = this.getArguments()[parameter.id]
      const literal = Array.isArray(fallback) ? `[${fallback.join(', ')}]` : String(fallback)
      return `${parameter.name} = ${connected ?? literal}`
    })
    return { value: { code: `${this.functionName}(${argumentsSource.join(', ')})` } }
  }
}

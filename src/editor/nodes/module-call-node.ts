import { ClassicPreset } from 'rete'
import type { DataflowNode } from 'rete-engine'

import { booleanSocket, geometrySocket, numberSocket, vector3Socket, type BooleanValue, type GeometryValue, type NumberValue, type Vector3Value } from '../sockets'
import { t } from '../../i18n/translate'
import { CheckboxControl, LabeledNumberControl, Vector3Control } from '../controls'
import { moduleParameterPortId, type ModuleDefinition, type ModuleParameter, type ModuleParameterDefault } from '../definitions'

/** A project-defined Module use. Its stable definition ID is the semantic
 * reference; the visible/OpenSCAD name is resolved from that definition at
 * construction time, never persisted as a second authority. */
export interface ModuleCallParams { definitionId: string; arguments?: Record<string, ModuleParameterDefault> }

export class ModuleCallNode extends ClassicPreset.Node<Record<string, ClassicPreset.Socket>, { geometry: ClassicPreset.Socket }, Record<string, LabeledNumberControl | CheckboxControl | Vector3Control>> implements DataflowNode {
  readonly definitionId: string
  private moduleName: string
  private parameters: readonly ModuleParameter[]
  private readonly onControlsChanged?: (nodeId: string) => void

  constructor(
    definition: Pick<ModuleDefinition, 'id' | 'name' | 'parameters'> | string,
    params: ModuleCallParams | string = typeof definition === 'string' ? '' : { definitionId: definition.id },
    onControlsChanged?: (nodeId: string) => void,
  ) {
    const resolved = typeof definition === 'string'
      ? { id: definition, name: params as string, parameters: [] as const }
      : definition
    const callParams = typeof params === 'string' ? { definitionId: resolved.id } : params
    super(resolved.name)
    this.definitionId = resolved.id
    this.moduleName = resolved.name
    this.parameters = resolved.parameters ?? []
    this.onControlsChanged = onControlsChanged
    this.materializeInputs(callParams.arguments ?? {})
    this.addOutput('geometry', new ClassicPreset.Output(geometrySocket, t('input.geometry')))
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
    this.moduleName = name
    this.label = name
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

  getPersistedParams(): ModuleCallParams { return { definitionId: this.definitionId, arguments: this.getArguments() } }

  data(inputs: Record<string, (NumberValue | BooleanValue | Vector3Value)[] | undefined>): { geometry: GeometryValue } {
    const argumentsSource = this.parameters.map((parameter) => {
      const key = moduleParameterPortId(parameter.id)
      const connected = inputs[key]?.[0]?.code
      const fallback = this.getArguments()[parameter.id]
      const literal = Array.isArray(fallback) ? `[${fallback.join(', ')}]` : String(fallback)
      return `${parameter.name} = ${connected ?? literal}`
    })
    return { geometry: { code: `${this.moduleName}(${argumentsSource.join(', ')});` } }
  }
}

import { ClassicPreset } from 'rete'
import type { DataflowNode } from 'rete-engine'

import { t } from '../../i18n/translate'
import { booleanSocket, numberSocket, vector3Socket, type BooleanValue, type NumberValue, type Vector3Value } from '../sockets'
import type { ModuleParameterType } from '../definitions'

export interface VariableReferenceParams {
  bindingId: string
}

export interface VariableBindingResolution {
  id: string
  name: string
  type: ModuleParameterType
}

export function validateVariableReferenceParams(value: unknown): VariableReferenceParams {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Invalid parameters: expected an object')
  }
  const bindingId = (value as Record<string, unknown>).bindingId
  if (typeof bindingId !== 'string' || bindingId.length === 0) {
    throw new Error('Invalid parameters: "bindingId" must be a non-empty string')
  }
  return { bindingId }
}

function socketForType(type: ModuleParameterType): ClassicPreset.Socket {
  return type === 'number' ? numberSocket : type === 'boolean' ? booleanSocket : vector3Socket
}

/** A compact, read-only use of one same-scope binding. The stable binding id
 * is persisted; the mutable name and type are always projected from the
 * definition and never duplicated as authoritative state. */
export class VariableReferenceNode extends ClassicPreset.Node<{}, { value: ClassicPreset.Socket }> implements DataflowNode {
  readonly bindingId: string
  private bindingType: ModuleParameterType

  constructor(params: VariableReferenceParams, binding: VariableBindingResolution) {
    super(binding.name)
    this.bindingId = params.bindingId
    this.bindingType = binding.type
    this.addOutput('value', new ClassicPreset.Output(socketForType(binding.type), t('output.variableReference')))
  }

  getBindingType(): ModuleParameterType { return this.bindingType }

  syncBinding(binding: VariableBindingResolution): void {
    this.label = binding.name
    if (binding.type === this.bindingType) return
    this.bindingType = binding.type
    const output = this.outputs.value
    if (output) output.socket = socketForType(binding.type)
  }

  getPersistedParams(): VariableReferenceParams { return { bindingId: this.bindingId } }

  data(): { value: NumberValue | BooleanValue | Vector3Value } {
    return { value: { code: this.label } }
  }
}

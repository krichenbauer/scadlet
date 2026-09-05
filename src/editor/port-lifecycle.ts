import { ClassicPreset, type NodeEditor } from 'rete'

import type { Schemes } from './schemes'
import { areSocketTypesCompatible } from './sockets'

/** Returns whether an input is currently the endpoint of a real connection. */
export function hasConnectedInputs(
  editor: NodeEditor<Schemes>,
  nodeId: string,
  inputKeys: readonly string[],
): boolean {
  const keys = new Set(inputKeys)
  return editor.getConnections().some((connection) => connection.target === nodeId && keys.has(connection.targetInput))
}

/**
 * The one low-level route for removing an existing semantic input. It removes
 * attached Rete connections first, then the input, so the graph can never
 * contain a wire whose target port has disappeared.
 */
export async function removeInputSafely(
  editor: NodeEditor<Schemes>,
  nodeId: string,
  inputKey: string,
): Promise<boolean> {
  const node = editor.getNode(nodeId)
  if (!node?.inputs[inputKey]) return false
  const attached = editor.getConnections().filter((connection) => connection.target === nodeId && connection.targetInput === inputKey)
  for (const connection of attached) await editor.removeConnection(connection.id)
  node.removeInput(inputKey)
  return true
}

/** The output counterpart keeps the endpoint invariant complete, even
 * though SCADlet's current dynamic ports are inputs. */
export async function removeOutputSafely(
  editor: NodeEditor<Schemes>,
  nodeId: string,
  outputKey: string,
): Promise<boolean> {
  const node = editor.getNode(nodeId)
  if (!node?.outputs[outputKey]) return false
  const attached = editor.getConnections().filter((connection) => connection.source === nodeId && connection.sourceOutput === outputKey)
  for (const connection of attached) await editor.removeConnection(connection.id)
  node.removeOutput(outputKey)
  return true
}

/** Defensive guard for direct node API use. Interactive code blocks a mode
 * switch before this is needed; callers that must reconfigure directly use
 * `removeInputSafely`/`removeOutputSafely` instead of creating an orphan. */
export function guardPortRemoval(editor: NodeEditor<Schemes>, node: Schemes['Node']): void {
  const guarded = node as ClassicPreset.Node & { __scadletPortRemovalGuarded?: boolean }
  if (guarded.__scadletPortRemovalGuarded) return
  guarded.__scadletPortRemovalGuarded = true

  const removeInput = node.removeInput.bind(node)
  node.removeInput = (key: string) => {
    if (hasConnectedInputs(editor, node.id, [key])) {
      throw new Error(`Cannot remove connected input ${key}; use removeInputSafely().`)
    }
    removeInput(key)
  }

  const removeOutput = node.removeOutput.bind(node)
  node.removeOutput = (key: string) => {
    if (editor.getConnections().some((connection) => connection.source === node.id && connection.sourceOutput === key)) {
      throw new Error(`Cannot remove connected output ${key}; use removeOutputSafely().`)
    }
    removeOutput(key)
  }
}

/** DOM-free regression helper for tests around dynamic node signatures. */
export function graphEndpointsAreValid(editor: NodeEditor<Schemes>): boolean {
  return editor.getConnections().every((connection) => {
    const source = editor.getNode(connection.source)
    const target = editor.getNode(connection.target)
    return Boolean(
      source?.outputs[connection.sourceOutput]
      && target?.inputs[connection.targetInput]
      && areSocketTypesCompatible(source.outputs[connection.sourceOutput]?.socket, target.inputs[connection.targetInput]?.socket),
    )
  })
}

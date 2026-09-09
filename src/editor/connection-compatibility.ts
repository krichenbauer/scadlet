import type { NodeEditor } from 'rete'

import type { Schemes } from './schemes'
import { areSocketTypesCompatible, socketType } from './sockets'
import { shareDefinitionScope } from './definitions'
import { FunctionOutputNode } from './nodes/function-interface-nodes'
import { ConditionalNode } from './nodes/value-nodes'

/** The sole semantic compatibility rule used for Rete creation and snap
 * acquisition: existing opposite-direction ports with identical types.
 *
 * Function Output's single `result` port is a deliberate, narrow exception:
 * its port stays reachable for any of the three supported value types even
 * while it's already connected to a different type, so `editor.ts` can run
 * its confirm/preflight replacement flow instead of the connection being
 * silently rejected before that flow ever gets a chance to run. */
export function canConnectSocketData(
  editor: NodeEditor<Schemes>,
  first: { nodeId: string; key: string; side: 'input' | 'output' },
  second: { nodeId: string; key: string; side: 'input' | 'output' },
): boolean {
  const sourceData = first.side === 'output' ? first : second.side === 'output' ? second : undefined
  const targetData = first.side === 'input' ? first : second.side === 'input' ? second : undefined
  if (!sourceData || !targetData) return false
  if (!shareDefinitionScope(editor, sourceData.nodeId, targetData.nodeId)) return false
  const sourceSocket = editor.getNode(sourceData.nodeId)?.outputs[sourceData.key]?.socket
  const targetNode = editor.getNode(targetData.nodeId)
  if (targetNode instanceof FunctionOutputNode && targetData.key === 'result') {
    const type = socketType(sourceSocket)
    return type === 'number' || type === 'boolean' || type === 'vector3'
  }
  // Conditional branch ports are another deliberately narrow transition
  // boundary. They accept a supported value source while the editor
  // preflights the resulting type change; Condition itself remains normal
  // Boolean-only compatibility.
  if (targetNode instanceof ConditionalNode && (targetData.key === 'true' || targetData.key === 'false')) {
    const type = socketType(sourceSocket)
    return type === 'number' || type === 'boolean' || type === 'vector3'
  }
  const targetSocket = targetNode?.inputs[targetData.key]?.socket
  return areSocketTypesCompatible(sourceSocket, targetSocket)
}

import type { NodeEditor } from 'rete'

import type { Schemes } from './schemes'
import { areSocketTypesCompatible } from './sockets'
import { shareDefinitionScope } from './definitions'

/** The sole semantic compatibility rule used for Rete creation and snap
 * acquisition: existing opposite-direction ports with identical types. */
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
  const targetSocket = editor.getNode(targetData.nodeId)?.inputs[targetData.key]?.socket
  return areSocketTypesCompatible(sourceSocket, targetSocket)
}

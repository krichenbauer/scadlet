import type { NodeEditor } from 'rete'
import type { DataflowEngine } from 'rete-engine'

import type { GeometryValue } from './sockets'
import type { Schemes } from './schemes'

/**
 * Evaluates the graph into a single OpenSCAD source string: one statement
 * per "root" node, where a root is a node whose `geometry` output isn't
 * consumed by another node's input. With no transformation/CSG nodes yet,
 * every node is currently a root, so each simply becomes an independent
 * top-level object - which is already valid, meaningful OpenSCAD.
 */
export async function evaluateOpenSCAD(
  editor: NodeEditor<Schemes>,
  engine: DataflowEngine<Schemes>,
): Promise<string> {
  engine.reset()

  const consumedNodeIds = new Set(editor.getConnections().map((connection) => connection.source))
  const roots = editor.getNodes().filter((node) => !consumedNodeIds.has(node.id))

  const fragments: string[] = []
  for (const node of roots) {
    const output = (await engine.fetch(node.id)) as { geometry?: GeometryValue }
    if (output.geometry) fragments.push(output.geometry.code)
  }

  return fragments.join('\n')
}

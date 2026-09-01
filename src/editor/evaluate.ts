import type { NodeEditor } from 'rete'
import type { DataflowEngine } from 'rete-engine'

import type { BooleanValue, GeometryValue, NumberValue, Vector3Value } from './sockets'
import type { Schemes } from './schemes'

/**
 * Evaluates the graph into a single OpenSCAD source string: one statement
 * per "root" node, where a root is a node whose `geometry` output isn't
 * consumed by another node's input. With no transformation/CSG nodes yet,
 * every node is currently a root, so each simply becomes an independent
 * top-level object - which is already valid, meaningful OpenSCAD.
 *
 * `rootNodeId`, when given, switches to the Inspect Node feature's mode:
 * instead of every unconsumed node, exactly that one node is evaluated as
 * the sole output root, reusing the same recursive `rete-engine` dataflow
 * fetch each of its upstream dependencies already goes through for a
 * normal evaluation - the graph itself, and its normal (non-rooted)
 * evaluation, are never mutated or otherwise affected by this. Returns
 * `''` if the id no longer refers to a node (e.g. it was just deleted).
 */
export async function evaluateOpenSCAD(
  editor: NodeEditor<Schemes>,
  engine: DataflowEngine<Schemes>,
  rootNodeId?: string,
): Promise<string> {
  engine.reset()

  if (rootNodeId !== undefined) {
    if (!editor.getNode(rootNodeId)) return ''
    const output = (await engine.fetch(rootNodeId)) as { geometry?: GeometryValue }
    return output.geometry?.code ?? ''
  }

  const consumedNodeIds = new Set(editor.getConnections().map((connection) => connection.source))
  const roots = editor.getNodes().filter((node) => !consumedNodeIds.has(node.id))

  const fragments: string[] = []
  for (const node of roots) {
    const output = (await engine.fetch(node.id)) as { geometry?: GeometryValue }
    if (output.geometry) fragments.push(output.geometry.code)
  }

  return fragments.join('\n')
}

export type InspectEvaluation =
  | { kind: 'geometry'; source: string }
  | { kind: 'value'; expression: string }
  | { kind: 'missing' }

/** Evaluates one explicitly inspected node while retaining the ordinary
 * geometry-only full-model evaluator above. Values are expressions that are
 * subsequently evaluated by OpenSCAD (via `echo()` in the worker), never by
 * TypeScript. */
export async function evaluateInspectNode(
  editor: NodeEditor<Schemes>,
  engine: DataflowEngine<Schemes>,
  nodeId: string,
): Promise<InspectEvaluation> {
  const node = editor.getNode(nodeId)
  if (!node) return { kind: 'missing' }
  engine.reset()
  if (node.outputs.geometry) return { kind: 'geometry', source: await evaluateOpenSCAD(editor, engine, nodeId) }
  const output = (await engine.fetch(nodeId)) as { value?: NumberValue | BooleanValue | Vector3Value }
  return output.value ? { kind: 'value', expression: output.value.code } : { kind: 'missing' }
}

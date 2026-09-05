import type { NodeEditor } from 'rete'
import type { DataflowEngine } from 'rete-engine'

import type { BooleanValue, GeometryValue, NumberValue, Vector3Value } from './sockets'
import type { Schemes } from './schemes'
import type { DefinitionRegistry, ModuleDefinition } from './definitions'

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
  definitions?: DefinitionRegistry,
): Promise<string> {
  if (rootNodeId !== undefined) {
    if (!editor.getNode(rootNodeId)) return ''
    const source = await evaluateGeometryRoot(engine, rootNodeId)
    return definitions ? joinDefinitions(await evaluateDefinitions(editor, engine, definitions), source) : source
  }

  const mainNodeIds = new Set(editor.getNodes()
    .filter((node) => (definitions?.scopeOf(node.id) ?? null) === null)
    .map((node) => node.id))
  const consumedNodeIds = new Set(editor.getConnections()
    .filter((connection) => mainNodeIds.has(connection.source) && mainNodeIds.has(connection.target))
    .map((connection) => connection.source))
  const roots = editor.getNodes().filter((node) => mainNodeIds.has(node.id) && !consumedNodeIds.has(node.id))

  const fragments: string[] = []
  for (const node of roots) {
    engine.reset()
    const output = (await engine.fetch(node.id)) as { geometry?: GeometryValue }
    if (output.geometry) fragments.push(output.geometry.code)
  }

  const main = fragments.join('\n')
  return definitions ? joinDefinitions(await evaluateDefinitions(editor, engine, definitions), main) : main
}

async function evaluateGeometryRoot(engine: DataflowEngine<Schemes>, nodeId: string): Promise<string> {
  engine.reset()
  const output = (await engine.fetch(nodeId)) as { geometry?: GeometryValue }
  return output.geometry?.code ?? ''
}

/** Module bodies reuse ordinary upstream Geometry evaluation. Output is a
 * sink/root marker, not an OpenSCAD-producing node, so follow its one input
 * to the existing Geometry producer. */
async function evaluateModuleBody(editor: NodeEditor<Schemes>, engine: DataflowEngine<Schemes>, definition: ModuleDefinition): Promise<string> {
  const connection = editor.getConnections().find((item) => item.target === definition.outputNodeId && item.targetInput === 'geometry')
  return connection ? evaluateGeometryRoot(engine, connection.source) : ''
}

async function evaluateDefinitions(editor: NodeEditor<Schemes>, engine: DataflowEngine<Schemes>, definitions: DefinitionRegistry): Promise<string> {
  const fragments: string[] = []
  for (const definition of definitions.list()) {
    const body = await evaluateModuleBody(editor, engine, definition)
    const indented = body ? `\n${body.split('\n').map((line) => `  ${line}`).join('\n')}\n` : '\n'
    fragments.push(`module ${definition.name}() {${indented}}`)
  }
  return fragments.join('\n\n')
}

function joinDefinitions(definitions: string, main: string): string {
  if (!definitions) return main
  return main ? `${definitions}\n\n${main}` : definitions
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
  definitions?: DefinitionRegistry,
): Promise<InspectEvaluation> {
  const node = editor.getNode(nodeId)
  if (!node) return { kind: 'missing' }
  engine.reset()
  if (node.outputs.geometry) return { kind: 'geometry', source: await evaluateOpenSCAD(editor, engine, nodeId, definitions) }
  const output = (await engine.fetch(nodeId)) as { value?: NumberValue | BooleanValue | Vector3Value }
  return output.value ? { kind: 'value', expression: output.value.code } : { kind: 'missing' }
}

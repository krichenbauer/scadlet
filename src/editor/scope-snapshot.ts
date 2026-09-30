import type { NodeEditor } from 'rete'

import type { DefinitionRegistry } from './definitions'
import type { LoopGraphConnection, LoopGraphNode } from './for-validation'
import { findCatalogEntry, identifyNodeType } from './node-catalog'
import type { Schemes } from './schemes'

/** One semantic scope of the live editor in the plain, `.scadlet`-shaped
 * form that the scope rules (`loopStructureProblem`) check. */
export interface ScopeSnapshot {
  nodes: LoopGraphNode[]
  connections: LoopGraphConnection[]
}

/**
 * Snapshots the nodes of one scope (`null` is Main) with their persisted
 * parameters, plus every connection whose two endpoints are in that scope.
 * Both keep the editor's own order. Nodes the catalog does not recognize are
 * skipped. `parameterOverrides` replaces one node's parameters, so a check can
 * see a proposed state (e.g. a rename) before it is applied.
 */
export function liveScopeSnapshot(
  editor: NodeEditor<Schemes>,
  definitions: DefinitionRegistry | undefined,
  scope: string | null,
  parameterOverrides: ReadonlyMap<string, Record<string, unknown>> = new Map(),
): ScopeSnapshot {
  const nodes = editor.getNodes()
    .filter((node) => (definitions?.scopeOf(node.id) ?? null) === scope)
    .flatMap((node) => {
      const type = identifyNodeType(node)
      const entry = type ? findCatalogEntry(type) : undefined
      if (!type || !entry) return []
      return [{ id: node.id, type, parameters: parameterOverrides.get(node.id) ?? entry.serializeParams(node) }]
    })
  const ids = new Set(nodes.map((node) => node.id))
  const connections = editor.getConnections()
    .filter((edge) => ids.has(edge.source) && ids.has(edge.target))
    .map((edge) => ({
      id: edge.id, source: edge.source, sourceOutput: String(edge.sourceOutput), target: edge.target, targetInput: String(edge.targetInput),
    }))
  return { nodes, connections }
}

/** The given roots plus every node they depend on through connections. */
export function upstreamNodeIds(
  connections: readonly { source: string; target: string }[],
  rootIds: readonly string[],
): Set<string> {
  const incoming = new Map<string, string[]>()
  for (const connection of connections) incoming.set(connection.target, [...(incoming.get(connection.target) ?? []), connection.source])
  const ids = new Set<string>()
  const pending = [...rootIds]
  while (pending.length > 0) {
    const id = pending.pop()!
    if (ids.has(id)) continue
    ids.add(id)
    pending.push(...(incoming.get(id) ?? []))
  }
  return ids
}

import type { NodeEditor } from 'rete'

import { findCatalogEntry, identifyNodeType } from '../editor/node-catalog'
import type { Position } from '../editor/coordinates'
import type { Schemes } from '../editor/schemes'
import type { ModuleDefinition } from '../editor/definitions'
import {
  SCADLET_FORMAT,
  SCADLET_VERSION,
  type ScadletProjectMetadata,
  type ScadletProjectV1,
  type ScadletViewerCamera,
} from './project'

export interface SerializeProjectOptions {
  editor: NodeEditor<Schemes>
  /** Project-level descriptive metadata; `updatedAt` is refreshed by this function (via `now`), any incoming value is ignored. */
  metadata: ScadletProjectMetadata
  /** Reads a node's current graph position - see `AreaPlugin.nodeViews` in `editor/editor.ts`. Injected so this stays testable without a real Rete `AreaPlugin`/DOM. */
  getNodePosition: (nodeId: string) => Position
  /** Reads whether a node is currently explicitly pinned (editor presentation state - see `editor/presentation.ts`). Defaults to "never pinned" when omitted. */
  isPinned?: (nodeId: string) => boolean
  /** The current canvas pan/zoom transform. */
  viewport: { x: number; y: number; k: number }
  /** The current viewer camera state - see `components/geometry-viewer.ts`. */
  viewerCamera: ScadletViewerCamera
  /** Injectable clock for `updatedAt`, overridable for deterministic tests. */
  now?: () => string
  /** Project-owned definition registry. Nodes are still read from Rete, but
   * grouped into their semantic graph rather than inferred from frame bounds. */
  definitions?: readonly ModuleDefinition[]
  getNodeScope?: (nodeId: string) => string | null
}

/**
 * Captures the complete current project into a `ScadletProjectV1`. Pure
 * with respect to the editor: reads `editor.getNodes()`/`getConnections()`
 * and the injected position/pin/viewport/camera accessors, but never
 * mutates anything. Node/connection ordering follows `NodeEditor`'s own
 * (insertion-order) iteration, so repeated saves of an unchanged project
 * are byte-for-byte stable apart from `metadata.updatedAt`.
 */
export function serializeProject(options: SerializeProjectOptions): ScadletProjectV1 {
  const { editor, getNodePosition, isPinned, viewport, viewerCamera } = options
  const now = options.now ?? (() => new Date().toISOString())

  const nodes = editor.getNodes().map((node) => {
    const type = identifyNodeType(node)
    if (!type) throw new Error(`Cannot serialize node "${node.id}": not a recognized catalog node type.`)
    const entry = findCatalogEntry(type)!
    const pinned = isPinned?.(node.id) ?? false

    return {
      id: node.id,
      type,
      position: getNodePosition(node.id),
      parameters: entry.serializeParams(node),
      ...(pinned ? { pinned: true } : {}),
    }
  })

  const connections = editor.getConnections().map((connection) => ({
    id: connection.id,
    source: connection.source,
    sourceOutput: String(connection.sourceOutput),
    target: connection.target,
    targetInput: String(connection.targetInput),
  }))

  const definitionIds = new Set((options.definitions ?? []).map((definition) => definition.id))
  const scopeOf = (nodeId: string): string | null => options.getNodeScope?.(nodeId) ?? null
  for (const connection of connections) {
    if (scopeOf(connection.source) !== scopeOf(connection.target)) {
      throw new Error(`Cannot serialize connection "${connection.id}": it crosses a definition scope boundary.`)
    }
  }
  const mainNodes = nodes.filter((node) => scopeOf(node.id) === null)
  const mainConnections = connections.filter((connection) => scopeOf(connection.source) === null && scopeOf(connection.target) === null)
  const definitions = (options.definitions ?? []).map((definition) => ({
    id: definition.id,
    kind: definition.kind,
    name: definition.name,
    interface: { inputs: definition.inputsNodeId, output: definition.outputNodeId },
    graph: {
      nodes: nodes.filter((node) => scopeOf(node.id) === definition.id),
      connections: connections.filter((connection) => scopeOf(connection.source) === definition.id && scopeOf(connection.target) === definition.id),
    },
  }))
  // A stale scope provider must never make a node disappear from the saved
  // project. Definitions are a closed registry, so unknown scopes remain in
  // Main where they retain ordinary graph semantics.
  const graph = definitionIds.size === 0
    ? { nodes, connections }
    : {
        nodes: mainNodes.concat(nodes.filter((node) => {
          const scope = scopeOf(node.id)
          return scope !== null && !definitionIds.has(scope)
        })),
        connections: mainConnections.concat(connections.filter((connection) => {
          const sourceScope = scopeOf(connection.source)
          const targetScope = scopeOf(connection.target)
          return (sourceScope !== null && !definitionIds.has(sourceScope)) || (targetScope !== null && !definitionIds.has(targetScope))
        })),
      }

  return {
    format: SCADLET_FORMAT,
    version: SCADLET_VERSION,
    metadata: { ...options.metadata, updatedAt: now() },
    graph,
    definitions,
    editor: { viewport: { x: viewport.x, y: viewport.y, zoom: viewport.k } },
    viewer: { camera: viewerCamera },
  }
}

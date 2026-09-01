import type { NodeEditor } from 'rete'

import { findCatalogEntry, identifyNodeType } from '../editor/node-catalog'
import type { Position } from '../editor/coordinates'
import type { Schemes } from '../editor/schemes'
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

  return {
    format: SCADLET_FORMAT,
    version: SCADLET_VERSION,
    metadata: { ...options.metadata, updatedAt: now() },
    graph: { nodes, connections },
    editor: { viewport: { x: viewport.x, y: viewport.y, zoom: viewport.k } },
    viewer: { camera: viewerCamera },
  }
}

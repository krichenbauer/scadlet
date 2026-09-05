import { ClassicPreset, type NodeEditor } from 'rete'

import { removeNodeWithConnections } from '../editor/deletion'
import { findCatalogEntry, type NodeCreationContext } from '../editor/node-catalog'
import type { Position } from '../editor/coordinates'
import type { Schemes } from '../editor/schemes'
import type { ModuleDefinition } from '../editor/definitions'
import type { ScadletProjectV1, ScadletViewerCamera } from './project'

/** Removes every node (and, transitively, every connection) currently in `editor`, one at a time, so per-node cleanup (presentation/inspect state - see `editor/editor.ts`'s `noderemoved` pipe) runs for each. */
export async function clearGraph(editor: NodeEditor<Schemes>): Promise<void> {
  for (const node of editor.getNodes()) {
    await removeNodeWithConnections(editor, node.id)
  }
}

export interface RestoreProjectDeps {
  editor: NodeEditor<Schemes>
  /** Context passed to each restored node's catalog `create()` (e.g. wiring up progressive-disclosure re-render) - see `editor/node-catalog.ts`. */
  creationContext: NodeCreationContext
  /** Applies a restored node's persisted position (e.g. `area.translate(id, position)`). */
  setNodePosition: (nodeId: string, position: Position) => void | Promise<void>
  /** Applies a restored node's persisted pin state (editor presentation, not graph semantics) - see `editor/presentation.ts`. Omit if pin state isn't wired up (e.g. in a DOM-free test). */
  setPinned?: (nodeId: string, pinned: boolean) => void
  /** Restores the canvas pan/zoom transform. Omit in a DOM-free test. */
  setViewport?: (viewport: { x: number; y: number; k: number }) => void | Promise<void>
  /** Restores the viewer camera. Omit if no viewer is present (e.g. in a DOM-free test). */
  setViewerCamera?: (camera: ScadletViewerCamera) => void
  /** Definition registry is registered before its interface nodes are
   * rebuilt, establishing scope ownership atomically during restore. */
  clearDefinitions?: () => void
  registerDefinition?: (definition: ModuleDefinition) => void
  /** Restores explicit ownership of ordinary Module-body nodes after their
   * definition has been registered. */
  assignNodeToDefinition?: (definitionId: string, nodeId: string) => void
}

/**
 * Restores a validated `ScadletProjectV1` into `deps.editor`, replacing
 * whatever graph currently exists. Callers must have already fully
 * parsed/validated the project (`validate.ts`'s `parseScadletProject`)
 * before calling this - by this point node types/parameters/connection
 * endpoints are all already known-good, so no further validation happens
 * here (AGENTS.md: atomic project loading - validate completely, only
 * then replace the current project).
 *
 * Deliberately reuses the existing node catalog (`editor/node-catalog.ts`)
 * for construction rather than hardcoded per-type restore logic, but
 * bypasses its normal auto-generated id: each node's exact persisted id
 * is applied immediately after construction, before it's added to the
 * graph, since connections must address those exact ids.
 */
export async function restoreProject(project: ScadletProjectV1, deps: RestoreProjectDeps): Promise<void> {
  await clearGraph(deps.editor)
  deps.clearDefinitions?.()

  // Calls in Main resolve their stable definition IDs during catalog
  // construction, so establish every definition before rebuilding either
  // graph. Nodes/connections themselves still restore in project order.
  for (const definitionDto of project.definitions) {
    deps.registerDefinition?.({
      id: definitionDto.id,
      kind: definitionDto.kind,
      name: definitionDto.name,
      inputsNodeId: definitionDto.interface.inputs,
      outputNodeId: definitionDto.interface.output,
      parameters: definitionDto.parameters,
    })
  }

  for (const nodeDto of project.graph.nodes) {
    const entry = findCatalogEntry(nodeDto.type)
    if (!entry) throw new Error(`Cannot restore node "${nodeDto.id}": unknown type "${nodeDto.type}"`)

    const node = entry.create(deps.creationContext, nodeDto.parameters)
    node.id = nodeDto.id
    await deps.editor.addNode(node)
    await deps.setNodePosition(nodeDto.id, nodeDto.position)
    if (nodeDto.pinned) deps.setPinned?.(nodeDto.id, true)
  }

  for (const connectionDto of project.graph.connections) {
    const source = deps.editor.getNode(connectionDto.source)
    const target = deps.editor.getNode(connectionDto.target)
    if (!source || !target) {
      throw new Error(`Cannot restore connection "${connectionDto.id}": endpoint node missing after node restore.`)
    }

    const connection = new ClassicPreset.Connection<ClassicPreset.Node, ClassicPreset.Node>(
      source,
      connectionDto.sourceOutput,
      target,
      connectionDto.targetInput,
    )
    connection.id = connectionDto.id
    await deps.editor.addConnection(connection)
  }

  for (const definitionDto of project.definitions) {
    for (const nodeDto of definitionDto.graph.nodes) {
      const entry = findCatalogEntry(nodeDto.type)
      if (!entry) throw new Error(`Cannot restore definition node "${nodeDto.id}": unknown type "${nodeDto.type}"`)
      const node = entry.create(deps.creationContext, nodeDto.parameters)
      node.id = nodeDto.id
      deps.assignNodeToDefinition?.(definitionDto.id, nodeDto.id)
      await deps.editor.addNode(node)
      await deps.setNodePosition(nodeDto.id, nodeDto.position)
      if (nodeDto.pinned) deps.setPinned?.(nodeDto.id, true)
    }
    for (const connectionDto of definitionDto.graph.connections) {
      const source = deps.editor.getNode(connectionDto.source)
      const target = deps.editor.getNode(connectionDto.target)
      if (!source || !target) throw new Error(`Cannot restore definition connection "${connectionDto.id}": endpoint node missing.`)
      const connection = new ClassicPreset.Connection<ClassicPreset.Node, ClassicPreset.Node>(
        source, connectionDto.sourceOutput, target, connectionDto.targetInput,
      )
      connection.id = connectionDto.id
      await deps.editor.addConnection(connection)
    }
  }

  if (deps.setViewport) {
    await deps.setViewport({ x: project.editor.viewport.x, y: project.editor.viewport.y, k: project.editor.viewport.zoom })
  }
  deps.setViewerCamera?.(project.viewer.camera)
}

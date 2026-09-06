import { ClassicPreset, type NodeEditor } from 'rete'

import { removeNodeWithConnections } from '../editor/deletion'
import { findCatalogEntry, type NodeCreationContext } from '../editor/node-catalog'
import type { Position } from '../editor/coordinates'
import type { Schemes } from '../editor/schemes'
import type { ModuleDefinition } from '../editor/definitions'
import { ModuleInputsNode } from '../editor/nodes/module-interface-nodes'
import { FunctionInputsNode, FunctionOutputNode } from '../editor/nodes/function-interface-nodes'
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
  /** A validated snapshot of the currently open project. When supplied,
   * reconstruction failures roll back to it instead of leaving a partial
   * graph in the editor. */
  rollbackProject?: ScadletProjectV1
}

interface PlannedNode {
  dto: ScadletProjectV1['graph']['nodes'][number]
  node: Schemes['Node']
  definitionId: string | null
}

interface RestorePlan {
  definitions: readonly ModuleDefinition[]
  nodes: readonly PlannedNode[]
  connections: readonly ScadletProjectV1['graph']['connections'][number][]
  project: ScadletProjectV1
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
  const plan = prepareRestorePlan(project, deps)
  // Prepare the rollback graph before clearing the live editor as well. A
  // failed node constructor must leave the already-open project untouched.
  const rollback = deps.rollbackProject ? prepareRestorePlan(deps.rollbackProject, deps) : undefined

  try {
    await applyRestorePlan(plan, deps)
  } catch (error) {
    if (rollback) {
      try {
        await applyRestorePlan(rollback, deps)
      } catch (rollbackError) {
        throw new Error('Could not restore the requested project or roll back the previously open project.', {
          cause: new AggregateError([error, rollbackError]),
        })
      }
    }
    throw error
  }
}

/** Constructs every node and verifies every concrete endpoint before the
 * current editor is touched. Dynamic Module ports are derived from the
 * definition signature, not from the deliberately-empty interface-node DTO. */
function prepareRestorePlan(project: ScadletProjectV1, deps: RestoreProjectDeps): RestorePlan {
  const definitions = project.definitions.map((definition) => ({
    id: definition.id,
    kind: definition.kind,
    name: definition.name,
    inputsNodeId: definition.interface.inputs,
    outputNodeId: definition.interface.output,
    parameters: definition.parameters,
    geometryInputs: definition.kind === 'module' ? definition.geometryInputs : undefined,
    resultType: definition.kind === 'function' ? definition.resultType : undefined,
  }))
  const definitionsById = new Map(definitions.map((definition) => [definition.id, definition]))
  const context: NodeCreationContext = {
    ...deps.creationContext,
    getModuleDefinition: (id) => definitionsById.get(id) ?? deps.creationContext.getModuleDefinition?.(id),
  }
  const nodes: PlannedNode[] = []

  const addNode = (dto: ScadletProjectV1['graph']['nodes'][number], definitionId: string | null) => {
    const definition = definitionId ? definitionsById.get(definitionId) : undefined
    const entry = findCatalogEntry(dto.type)
    if (!entry) throw new Error(`Cannot restore node "${dto.id}": unknown type "${dto.type}"`)
    const node = dto.type === 'module-inputs'
      ? new ModuleInputsNode(definition?.parameters ?? [], definition?.geometryInputs ?? [])
      : dto.type === 'function-inputs'
        ? new FunctionInputsNode(definition?.parameters ?? [])
        : dto.type === 'function-output'
          ? new FunctionOutputNode(definition?.resultType)
          : entry.create(context, dto.parameters)
    node.id = dto.id
    nodes.push({ dto, node, definitionId })
  }

  for (const node of project.graph.nodes) addNode(node, null)
  for (const definition of project.definitions) {
    for (const node of definition.graph.nodes) addNode(node, definition.id)
  }

  const nodesById = new Map(nodes.map((item) => [item.node.id, item.node]))
  const connections = [...project.graph.connections, ...project.definitions.flatMap((definition) => definition.graph.connections)]
  for (const connection of connections) {
    const source = nodesById.get(connection.source)
    const target = nodesById.get(connection.target)
    if (!source?.outputs[connection.sourceOutput] || !target?.inputs[connection.targetInput]) {
      throw new Error(`Cannot restore connection "${connection.id}": its prepared port is missing.`)
    }
    if (source.outputs[connection.sourceOutput]?.socket.name !== target.inputs[connection.targetInput]?.socket.name) {
      throw new Error(`Cannot restore connection "${connection.id}": its prepared ports have incompatible socket types.`)
    }
  }

  return { definitions, nodes, connections, project }
}

async function applyRestorePlan(plan: RestorePlan, deps: RestoreProjectDeps): Promise<void> {
  await clearGraph(deps.editor)
  deps.clearDefinitions?.()

  // Calls in Main resolve their stable definition IDs during catalog
  // construction, so establish every definition before attaching the
  // already-prepared graph to Rete.
  for (const definition of plan.definitions) deps.registerDefinition?.(definition)

  for (const item of plan.nodes) {
    if (item.definitionId) deps.assignNodeToDefinition?.(item.definitionId, item.node.id)
    await deps.editor.addNode(item.node)
  }
  for (const connectionDto of plan.connections) {
    const source = deps.editor.getNode(connectionDto.source)
    const target = deps.editor.getNode(connectionDto.target)
    if (!source || !target) throw new Error(`Cannot restore connection "${connectionDto.id}": endpoint node missing after node restore.`)
    const connection = new ClassicPreset.Connection<ClassicPreset.Node, ClassicPreset.Node>(source, connectionDto.sourceOutput, target, connectionDto.targetInput)
    connection.id = connectionDto.id
    await deps.editor.addConnection(connection)
  }
  for (const item of plan.nodes) {
    await deps.setNodePosition(item.node.id, item.dto.position)
    if (item.dto.pinned) deps.setPinned?.(item.node.id, true)
  }

  if (deps.setViewport) {
    await deps.setViewport({ x: plan.project.editor.viewport.x, y: plan.project.editor.viewport.y, k: plan.project.editor.viewport.zoom })
  }
  deps.setViewerCamera?.(plan.project.viewer.camera)
}

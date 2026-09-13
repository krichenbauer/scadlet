import { ClassicPreset, NodeEditor } from 'rete'
import { AreaExtensions, AreaPlugin, Zoom } from 'rete-area-plugin'
import { ClassicFlow, ConnectionPlugin, type SocketData } from 'rete-connection-plugin'
import { DataflowEngine } from 'rete-engine'

import { clientToGraphPosition, type Position } from './coordinates'
import { canvasContentBounds, fitCanvasBounds, type CanvasContentItem } from './view-fit'
import { evaluateInspectNode, evaluateOpenSCAD, type InspectEvaluation } from './evaluate'
import { isEditableTarget, removeNodeWithConnections } from './deletion'
import { isDirtyAreaSignal, isDirtyEditorSignal } from './dirty'
import { InspectManager } from './inspect'
import { attachMarqueeSelection } from './marquee'
import { findCatalogEntry, FUNCTION_GRAPH_ALLOWED_NODE_TYPES, type NodeCreationContext, type NodeTypeId } from './node-catalog'
import { NodePresentationManager } from './presentation'
import { attachRenderer } from './render'
import type { AreaExtra, Schemes } from './schemes'
import { attachNodeSelection } from './selection'
import { BooleanOpNode } from './nodes/boolean-op-node'
import { ConnectionGestureManager, type ConnectionGestureOrigin } from './connection-gesture'
import { socketType, type SocketType } from './sockets'
import { guardPortRemoval, hasConnectedInputs, removeInputSafely, removeOutputSafely } from './port-lifecycle'
import { ConnectionSelectionManager } from './connection-selection'
import { canConnectSocketData, wouldCreateNodeDataflowCycle } from './connection-compatibility'
import { DefinitionRegistry, bindDefinitionRegistry, defaultModuleGeometryInput, moduleGeometryInputPortId, moduleNameProblem, moduleParameterDefaultIsValid, moduleParameterNameProblem, moduleParameterPortId, type FunctionResultType, type ModuleDefinition, type ModuleGeometryInput, type ModuleParameter, type ModuleParameterDefault, type ModuleParameterType } from './definitions'
import { attachDefinitionFrames, definitionFrameBounds, type DefinitionFrameBounds } from './definition-frames'
import { ModuleInputsNode, ModuleOutputNode } from './nodes/module-interface-nodes'
import { ModuleCallNode } from './nodes/module-call-node'
import { FunctionInputsNode, FunctionOutputNode } from './nodes/function-interface-nodes'
import { FunctionCallNode } from './nodes/function-call-node'
import { ConditionalNode, TrigonometryNode, type TrigonometryOperation } from './nodes/value-nodes'
import { scopeTransferProblem, type ScopeTransferProblem } from './scope-transfer'
import { t } from '../i18n/translate'
import { analyzeFunctionDependencies } from './function-dependencies'

/** The displayed Geometry Inspect source is rooted at one node, so its
 * participating canvas nodes are exactly that root plus its incoming graph
 * dependencies. This is transient presentation data, never graph state. */
function inspectParticipatingNodeIds(editor: NodeEditor<Schemes>, rootNodeId: string | null): Set<string> {
  if (!rootNodeId || !editor.getNode(rootNodeId)) return new Set()
  const incoming = new Map<string, string[]>()
  for (const connection of editor.getConnections()) {
    const sources = incoming.get(connection.target) ?? []
    sources.push(connection.source)
    incoming.set(connection.target, sources)
  }
  const ids = new Set<string>()
  const pending = [rootNodeId]
  while (pending.length > 0) {
    const id = pending.pop()!
    if (ids.has(id)) continue
    ids.add(id)
    pending.push(...(incoming.get(id) ?? []))
  }
  return ids
}

export interface SCADletEditor {
  editor: NodeEditor<Schemes>
  area: AreaPlugin<Schemes, AreaExtra>
  /** The node-creation context passed to catalog `create()` calls - reused by `.scadlet` project restore (`persistence/restore.ts`) so restored nodes get the same progressive-disclosure wiring as normally-created ones. */
  creationContext: NodeCreationContext
  /**
   * Creates a node of the given catalog type and places it so that
   * `clientPosition` (viewport coordinates, e.g. `event.clientX/Y`)
   * becomes its top-left origin in graph space. The single creation path
   * used by palette drag/drop.
   */
  addNodeAt(type: string, clientPosition: Position, params?: Record<string, unknown>): Promise<void>
  /** Creates a generic Call node for a project Module in Main only. Drops
   * inside a definition frame are deliberately refused in Phase 2. */
  addModuleCallAt(definitionId: string, clientPosition: Position): Promise<boolean>
  /**
   * Evaluates the graph into OpenSCAD source. With no argument this is
   * the normal full-model evaluation (unchanged). Passing `rootNodeId`
   * evaluates only that node's upstream subtree instead - the Inspect
   * Node feature's preview source - without mutating the graph or
   * affecting the normal (no-argument) evaluation in any way.
   */
  evaluate(rootNodeId?: string): Promise<string>
  /** Evaluates an inspect root as either geometry source or a typed OpenSCAD expression. */
  evaluateInspect(nodeId: string): Promise<InspectEvaluation>
  /** Commits the successful Geometry Inspect which just replaced the viewer preview. */
  commitGeometryInspect(nodeId: string): void
  /** Commits the successful Value Inspect and its displayed OpenSCAD result. */
  commitValueInspect(nodeId: string, value: string): void
  /** Clears Inspect provenance and its visual marker without changing graph/project state. */
  clearInspect(): void
  /** The node id that produced the currently displayed Inspect result, or `null`. */
  getInspectedNodeId(): string | null
  isGeometryNode(nodeId: string): boolean
  getInspectParticipatingNodeIds(): ReadonlySet<string>
  /** Safely removes a dynamic port and all of its attached connections. */
  removeInputSafely(nodeId: string, inputKey: string): Promise<boolean>
  removeOutputSafely(nodeId: string, outputKey: string): Promise<boolean>
  /** Whether `nodeId` is currently explicitly pinned open (editor presentation state - see `presentation.ts`). */
  isPinned(nodeId: string): boolean
  /** Sets a node's pinned state directly (used by `.scadlet` project restore) rather than toggling. */
  setPinned(nodeId: string, pinned: boolean): void
  createModule(name: string): Promise<ModuleDefinition>
  renameModule(definitionId: string, name: string): Promise<boolean>
  deleteModule(definitionId: string): Promise<boolean>
  focusModule(definitionId: string): Promise<void>
  addModuleParameter(definitionId: string, parameter: { name: string; type: ModuleParameterType; default: ModuleParameterDefault }): Promise<void>
  editModuleParameter(definitionId: string, parameterId: string, update: { name?: string; type?: ModuleParameterType; default?: ModuleParameterDefault; move?: -1 | 1 }): Promise<boolean>
  deleteModuleParameter(definitionId: string, parameterId: string): Promise<boolean>
  addModuleGeometryInput(definitionId: string, name?: string): Promise<void>
  editModuleGeometryInput(definitionId: string, inputId: string, update: { name?: string; move?: -1 | 1 }): Promise<boolean>
  deleteModuleGeometryInput(definitionId: string, inputId: string): Promise<boolean>
  /** Creates a generic Call node for a resolved project Function in Main or
   * in a Function scope (never in a Module scope). */
  addFunctionCallAt(definitionId: string, clientPosition: Position): Promise<boolean>
  createFunction(name: string): Promise<ModuleDefinition>
  renameFunction(definitionId: string, name: string): Promise<boolean>
  deleteFunction(definitionId: string): Promise<boolean>
  focusFunction(definitionId: string): Promise<void>
  addFunctionParameter(definitionId: string, parameter: { name: string; type: ModuleParameterType; default: ModuleParameterDefault }): Promise<void>
  editFunctionParameter(definitionId: string, parameterId: string, update: { name?: string; type?: ModuleParameterType; default?: ModuleParameterDefault; move?: -1 | 1 }): Promise<boolean>
  deleteFunctionParameter(definitionId: string, parameterId: string): Promise<boolean>
  getDefinitions(): readonly ModuleDefinition[]
  getNodeScope(nodeId: string): string | null
  clearDefinitions(): void
  registerDefinition(definition: ModuleDefinition): void
  assignNodeToDefinition(definitionId: string, nodeId: string): void
  onDefinitionsChange(callback: () => void): () => void
  /**
   * Subscribes to "the project has unsaved changes" notifications:
   * node/connection add/remove, node move, canvas pan/zoom, pin state,
   * and persisted-parameter control edits (see `dirty.ts` and
   * `node-catalog.ts`'s `wireDirtyNotifications`) - project-name edits
   * are tracked separately in `scadlet-app.ts`. Returns an unsubscribe
   * function.
   */
  onDirty(callback: () => void): () => void
  /** Subscribes to graph-semantic changes, excluding layout and presentation changes. */
  onSemanticChange(callback: () => void): () => void
  /** Subscribes to one-shot Inspect actions initiated by node double-clicks. */
  onInspect(callback: (nodeId: string) => void): () => void
  /** Fits the visible nodes and definition frames without changing persisted viewport state. */
  fitVisibleContent(): Promise<boolean>
  /** The viewport to serialize; transient recovery transforms are deliberately excluded. */
  getPersistedViewport(): { x: number; y: number; k: number }
  /** Applies a restored persistent viewport without treating it as a user edit. */
  setPersistedViewport(viewport: { x: number; y: number; k: number }): Promise<void>
  /**
   * Runs `fn`, suppressing all `onDirty` notifications for its duration -
   * used by `.scadlet` project restore, which necessarily performs
   * operations (adding nodes, moving them, restoring pin state/viewport)
   * that would otherwise look like user edits and incorrectly leave a
   * freshly loaded project dirty.
   */
  withDirtyTrackingSuspended<T>(fn: () => Promise<T>): Promise<T>
  destroy(): void
}

/** Installs the same semantic connection gate used by the browser editor.
 * Exported for DOM-free regression tests and for any future editor host that
 * intentionally reuses SCADlet's graph semantics. */
export function attachSocketCompatibilityGuard(
  editor: NodeEditor<Schemes>,
  onDataflowCycleRejected: () => void = () => {},
): void {
  editor.addPipe((context) => {
    if (context.type !== 'connectioncreate') return context
    const source = {
      nodeId: context.data.source, key: context.data.sourceOutput, side: 'output',
    } as const
    const target = {
      nodeId: context.data.target, key: context.data.targetInput, side: 'input',
    } as const
    if (!canConnectSocketData(editor, source, target)) return undefined
    if (wouldCreateNodeDataflowCycle(editor, source, target)) {
      onDataflowCycleRejected()
      return undefined
    }
    return context
  })
}

/** Atomically changes Trigonometry's one dynamic signature. It is exported
 * so the cancellation/rollback contract can be exercised without a browser;
 * the live editor supplies localized confirmation and dirty suppression. */
export async function transitionTrigonometryOperation(
  editor: NodeEditor<Schemes>,
  node: TrigonometryNode,
  operation: TrigonometryOperation,
  confirmRemoval: (connectionCount: number) => boolean,
  updateNode: () => void | Promise<void> = () => {},
): Promise<boolean> {
  const previous = node.getPersistedParams()
  if (previous.operation === operation) return true
  const affected = operation === 'atan2' ? [] : editor.getConnections().filter(
    (item) => item.target === node.id && item.targetInput === 'b',
  )
  if (affected.length > 0 && !confirmRemoval(affected.length)) return false

  try {
    for (const connection of affected) await editor.removeConnection(connection.id)
    node.setOperation(operation)
    await updateNode()
    return true
  } catch {
    try {
      node.setOperation(previous.operation, previous.b)
      for (const connection of affected) {
        if (!editor.getConnections().some((candidate) => candidate.id === connection.id)) await editor.addConnection(connection)
      }
      await updateNode()
    } catch {
      // The caller reports failure; no partial change is intentionally saved.
    }
    return false
  }
}

/**
 * Wires up the minimum set of Rete plugins needed to add and connect
 * nodes on screen: the graph itself, the pan/zoom area, drag-to-connect
 * behavior, and the Lit-based renderer.
 *
 * Graph evaluation / OpenSCAD code generation is intentionally out of
 * scope here and will be added in a later step.
 */
export async function createEditor(container: HTMLElement): Promise<SCADletEditor> {
  const editor = new NodeEditor<Schemes>()
  const area = new AreaPlugin<Schemes, AreaExtra>(container)
  const connection = new ConnectionPlugin<Schemes, AreaExtra>()
  const connectionGesture = new ConnectionGestureManager()
  const connectionSelection = new ConnectionSelectionManager()
  const definitions = new DefinitionRegistry()
  bindDefinitionRegistry(editor, definitions)
  const engine = new DataflowEngine<Schemes>((node) => ({
    inputs: () => Object.keys(node.inputs),
    outputs: () => Object.keys(node.outputs),
  }))
  let showDataflowCycleFeedback: () => void = () => {}
  const canCreateConnection = (
    from: Pick<SocketData, 'nodeId' | 'key' | 'side'>,
    to: Pick<SocketData, 'nodeId' | 'key' | 'side'>,
  ): boolean => {
    if (!canConnectSocketData(editor, from, to)) return false
    if (!wouldCreateNodeDataflowCycle(editor, from, to)) return true
    showDataflowCycleFeedback()
    return false
  }

  // Rete's own node-selection extension is the single source of truth
  // for which nodes are selected (`node.selected`, read by both the
  // renderer and deletion below) - `attachNodeSelection` only layers a
  // couple of small multi-selection behaviors on top of it (see
  // `selection.ts`), it does not replace it.
  const nodeSelection = attachNodeSelection(editor, area)
  const clearNodeSelection = (): void => {
    for (const node of editor.getNodes().filter((node) => node.selected)) void nodeSelection.unselect(node.id)
  }

  // Rete's classic preset intentionally treats socket names as display
  // metadata. SCADlet has a closed semantic socket vocabulary, so enforce
  // its diagonal-only compatibility here for drag/click creation as well as
  // the editor `connectioncreate` guard below for programmatic creation.
  connection.addPreset(() => new ClassicFlow({
    canMakeConnection: (from, to) => canCreateConnection(from, to),
  }))

  // Rete emits these signals for both drag and click connection flows. They
  // reconcile temporary disclosure with its actual completion; the capture
  // bridge below establishes a gesture before Rete stops the socket event.
  const syncConnectionGesture = (context: { type: string, data?: unknown }) => {
    if (context.type === 'connectionpick') {
      const { socket } = context.data as { socket: SocketData }
      const node = editor.getNode(socket.nodeId)
      const reteSocket = socket.side === 'output'
        ? node?.outputs[socket.key]?.socket
        : node?.inputs[socket.key]?.socket
      const type = socketType(reteSocket)
      if (type) connectionGesture.begin({ nodeId: socket.nodeId, socketKey: socket.key, side: socket.side, socketType: type })
    } else if (context.type === 'connectiondrop') {
      const { created, socket } = context.data as { created?: boolean; socket?: SocketData | null }
      // ClassicFlow can reject an attempted direct socket drop before it
      // emits `connectioncreate`. Preserve its no-mutation behavior while
      // still explaining this otherwise silent dataflow-cycle rejection.
      if (socket && connectionGesture.active && wouldCreateNodeDataflowCycle(editor, {
        nodeId: connectionGesture.active.origin.nodeId,
        key: connectionGesture.active.origin.socketKey,
        side: connectionGesture.active.origin.side,
      }, socket)) {
        showDataflowCycleFeedback()
      }
      // Rete drops a drag that ended beside (rather than directly on) a
      // socket before our bridge can commit its snap target. Keep that
      // transient target for the same pointerup; exact Rete completions and
      // ordinary cancellations still clear immediately.
      if (created || socket || !connectionGesture.active?.snapTarget) connectionGesture.complete()
    }
  }

  editor.use(area)
  editor.use(engine)
  area.use(connection)
  // `connectionpick`/`connectiondrop` are emitted by the child connection
  // scope and received by its parent Area scope, rather than re-entering the
  // child plugin's own pipe.
  area.addPipe((context) => {
    syncConnectionGesture(context)
    return context
  })
  const commitSnappedConnection = (): boolean => {
    const active = connectionGesture.active
    const snap = active?.snapTarget
    if (!active || !snap) return false
    const source = active.origin.side === 'output'
      ? { nodeId: active.origin.nodeId, key: active.origin.socketKey }
      : { nodeId: snap.nodeId, key: snap.socketKey }
    const target = active.origin.side === 'input'
      ? { nodeId: active.origin.nodeId, key: active.origin.socketKey }
      : { nodeId: snap.nodeId, key: snap.socketKey }
    if (editor.getConnections().some((connection) => connection.target === target.nodeId && connection.targetInput === target.key)) return false
    const from = editor.getNode(source.nodeId)
    const to = editor.getNode(target.nodeId)
    if (!from || !to || !canCreateConnection(
      { nodeId: source.nodeId, key: source.key, side: 'output' },
      { nodeId: target.nodeId, key: target.key, side: 'input' },
    )) return false
    connection.drop()
    connectionGesture.complete()
    // Let Rete finish its pointerup/drop bookkeeping before inserting the
    // explicit snapped connection. Otherwise its still-running pseudo-flow
    // can race a just-created real connection on the same release.
    window.setTimeout(() => {
      void editor.addConnection(new ClassicPreset.Connection(from, source.key, to, target.key) as Schemes['Connection'])
        .then((created) => {
        if (created) void area.update('node', target.nodeId)
        })
    })
    return true
  }
  const detachConnectionGestureEvents = attachConnectionGestureEvents(
    container,
    connectionGesture,
    commitSnappedConnection,
    (origin, target) => {
      if (!wouldCreateNodeDataflowCycle(editor, {
        nodeId: origin.nodeId, key: origin.socketKey, side: origin.side,
      }, target)) return false
      showDataflowCycleFeedback()
      return true
    },
  )

  // This is the authoritative live-graph gate. It runs before Rete mutates
  // its connection list, so even callers that construct a
  // `ClassicPreset.Connection` directly cannot insert Geometry→Number,
  // Geometry→Vector3, Geometry→Boolean, or any other implicit conversion.
  attachSocketCompatibilityGuard(editor, () => showDataflowCycleFeedback())
  let showScopeTransferFeedback: (problem: ScopeTransferProblem) => void = () => {}

  /** Builds the effective dependency graph. Calls participate only when they
   * can reach their owning definition Output. */
  const definitionDependencies = () => analyzeFunctionDependencies(
    definitions.list().map((definition) => ({ id: definition.id, kind: definition.kind, outputNodeId: definition.outputNodeId })),
    editor.getNodes().map((node) => ({
      id: node.id,
      scope: definitions.scopeOf(node.id),
      ...(node instanceof FunctionCallNode ? { calledFunctionId: node.definitionId } : {}),
      ...(node instanceof ModuleCallNode ? { calledModuleId: node.definitionId } : {}),
    })),
    editor.getConnections(),
  )

  // Function Output's single `result` port stays reachable for any of the
  // three supported value types even while already connected to a
  // different type (see `connection-compatibility.ts`'s special case), so
  // this second, Function-specific gate can run the confirm/preflight
  // replacement flow itself instead of the generic diagonal-only check
  // silently rejecting the new connection before that flow ever runs. This
  // pipe is registered after the generic guard, so an incompatible type has
  // already been rejected by the time this one ever sees the signal.
  editor.addPipe(async (context) => {
    if (context.type !== 'connectioncreate') return context
    const target = editor.getNode(context.data.target)
    if (target instanceof FunctionOutputNode && context.data.targetInput === 'result') {
      return (await handleFunctionResultConnectionAttempt(context.data)) ? context : undefined
    }
    return context
  })
  editor.addPipe(async (context) => {
    if (context.type !== 'connectioncreate') return context
    const target = editor.getNode(context.data.target)
    if (target instanceof ConditionalNode && (context.data.targetInput === 'true' || context.data.targetInput === 'false')) {
      return (await handleConditionalBranchConnectionAttempt(context.data)) ? context : undefined
    }
    return context
  })
  editor.addPipe((context) => {
    if (context.type === 'nodecreated') {
      const node = editor.getNode(context.data.id)
      if (node) guardPortRemoval(editor, node)
      if (node instanceof ModuleInputsNode) {
        const definitionId = definitions.scopeOf(node.id)
        if (definitionId) {
          const update = () => void area.update('node', node.id)
          node.configureParameterCreation(update, (parameter) => addModuleParameter(definitionId, parameter))
          node.configureParameterEditing(
            update,
            async (parameterId, change) => { await editModuleParameter(definitionId, parameterId, change) },
            (parameterId) => deleteModuleParameter(definitionId, parameterId),
            async (parameterId, move) => { await editModuleParameter(definitionId, parameterId, { move }) },
          )
          node.configureGeometryInputEditing(
            update,
            async (name) => { await addModuleGeometryInput(definitionId, name) },
            async (inputId, name) => editModuleGeometryInput(definitionId, inputId, { name }),
            (inputId) => deleteModuleGeometryInput(definitionId, inputId),
            (inputId, move) => editModuleGeometryInput(definitionId, inputId, { move }),
          )
        }
      }
      if (node instanceof FunctionInputsNode) {
        const definitionId = definitions.scopeOf(node.id)
        if (definitionId) {
          const update = () => void area.update('node', node.id)
          node.configureParameterCreation(update, (parameter) => addFunctionParameter(definitionId, parameter))
          node.configureParameterEditing(
            update,
            async (parameterId, change) => { await editFunctionParameter(definitionId, parameterId, change) },
            (parameterId) => deleteFunctionParameter(definitionId, parameterId),
            async (parameterId, move) => { await editFunctionParameter(definitionId, parameterId, { move }) },
          )
        }
      }
    }
    return context
  })

  // Presentation state (collapsed / temporarily expanded / pinned - see
  // `presentation.ts`) is intentionally kept outside the Rete graph model,
  // so it lives here rather than as node data. `onChange` re-renders just
  // the affected node, the same mechanism Cylinder's progressive
  // disclosure already uses.
  const presentation = new NodePresentationManager({
    onChange: (id) => void area.update('node', id),
  })

  // Inspect Node state (which node, if any, is the temporary preview
  // root - see `inspect.ts`) is likewise kept outside the Rete graph
  // model and outside `NodePresentationManager`: it is an independent
  // concept from expanded/pinned, not another boolean on the same class.
  const inspect = new InspectManager({
    onChange: (id) => void area.update('node', id),
    onScopeChange: () => { for (const node of editor.getNodes()) void area.update('node', node.id) },
  })
  const unsubscribeConnectionSelection = connectionSelection.subscribe((previous, current) => {
    if (previous) void area.update('connection', previous)
    if (current) void area.update('connection', current)
  })

  // "Unsaved changes" tracking (Milestone 5 persistence). Signal->dirty
  // decisions live in the pure, unit-tested predicates in `dirty.ts`
  // rather than being inlined here, so the exact set of signals that
  // count as a persisted change is easy to review/extend without a real
  // `NodeEditor`/`AreaPlugin`. `dirtySuspended` lets `.scadlet` project
  // restore (`scadlet-app.ts`) perform node/connection/position/pin/
  // viewport operations that would otherwise look like user edits
  // without leaving the freshly loaded project dirty.
  const dirtyListeners = new Set<() => void>()
  const semanticListeners = new Set<() => void>()
  const inspectListeners = new Set<(nodeId: string) => void>()
  let dirtySuspended = false
  let transientViewportChange = false
  let persistedViewport = { ...area.area.transform }
  let activeScopeDrag: {
    nodeIds: string[]
    startPositions: Map<string, Position>
    /** Frozen source boundaries prevent a moved member from taking its own
     * source frame along for the drag, which would make dropping to Main
     * impossible. */
    sourceFrameBounds: Map<string, DefinitionFrameBounds>
    moved: boolean
  } | null = null
  let scopeDestination: { definitionId: string; valid: boolean } | null = null
  function notifyDirty(): void {
    if (dirtySuspended) return
    for (const listener of dirtyListeners) listener()
  }
  function notifySemanticChange(): void {
    if (dirtySuspended) return
    for (const listener of semanticListeners) listener()
  }
  function notifySemanticDirty(): void {
    notifyDirty()
    notifySemanticChange()
  }
  const unsubscribeDefinitions = definitions.subscribe(() => notifySemanticDirty())

  editor.addPipe((context) => {
    if (isDirtyEditorSignal(context.type)) notifySemanticDirty()
    return context
  })

  // Variadic Boolean child slots grow only when their trailing extension
  // port becomes connected. This runs against Rete's authoritative
  // connection list and never reindexes an existing slot/connection.
  editor.addPipe((context) => {
    if (context.type === 'connectioncreated' || context.type === 'connectionremoved') {
      if (context.type === 'connectionremoved') connectionSelection.remove(context.data.id)
      // Recompute which parameter inputs (non-geometry) are connected for each node.
      // Only parameter sockets (number, vector3) force a partial expansion; geometry
      // connections never do - that was the bug that prevented Translate/Rotate/Scale
      // from collapsing after Milestone 6 added parameter sockets.
      for (const node of editor.getNodes()) {
        const connectedParamInputs = new Set(
          editor.getConnections()
            .filter((conn) => conn.target === node.id)
            .filter((conn) => (node.inputs[conn.targetInput]?.socket.name ?? 'geometry') !== 'geometry')
            .map((conn) => conn.targetInput),
        )
        presentation.setConnectedInputs(node.id, connectedParamInputs)
      }
      for (const node of editor.getNodes()) {
        if (!(node instanceof BooleanOpNode)) continue
        const connected = new Set(editor.getConnections().filter((item) => item.target === node.id).map((item) => item.targetInput))
        if (node.synchronizeChildren(connected)) void area.update('node', node.id)
      }
    }
    return context
  })
  area.addPipe((context) => {
    if ((context.type === 'translated' || context.type === 'zoomed') && !transientViewportChange) {
      persistedViewport = { ...area.area.transform }
    }
    if (isDirtyAreaSignal(context.type) && !(context.type === 'nodetranslated' && activeScopeDrag) && !transientViewportChange) notifyDirty()
    return context
  })

  const selectConnection = (connectionId: string): void => {
    if (connectionGesture.active) {
      connection.drop()
      connectionGesture.cancel()
    }
    clearNodeSelection()
    connectionSelection.select(connectionId)
    container.focus({ preventScroll: true })
  }
  const selectDefinition = async (definitionId: string): Promise<void> => {
    connectionSelection.clear()
    clearNodeSelection()
    const nodeIds = definitions.nodeIds(definitionId).filter((nodeId) => Boolean(editor.getNode(nodeId)))
    for (const [index, nodeId] of nodeIds.entries()) {
      await nodeSelection.select(nodeId, index > 0)
    }
    container.focus({ preventScroll: true })
  }
  const detachRenderer = attachRenderer(
    editor,
    area,
    connection,
    presentation,
    inspect,
    connectionGesture,
    connectionSelection,
    notifyDirty,
    (nodeId) => {
      if (inspect.id === nodeId) {
        inspect.clear()
        return
      }
      inspect.activate(nodeId, inspectParticipatingNodeIds(editor, nodeId))
      for (const listener of inspectListeners) listener(nodeId)
    },
    (nodeId) => {
      connectionSelection.clear()
      if (inspect.id !== null && !inspect.participates(nodeId)) inspect.clear()
    },
    selectConnection,
  )
  const detachDefinitionFrames = attachDefinitionFrames(area, definitions, {
    select: selectDefinition,
    translateSelected: (dx, dy) => nodeSelection.translate(dx, dy),
    scopeTransferState: (definitionId) => scopeDestination?.definitionId === definitionId
      ? scopeDestination.valid ? 'valid' : 'invalid'
      : null,
    scopeTransferFrameBounds: (definitionId) => activeScopeDrag?.sourceFrameBounds.get(definitionId) ?? null,
  })

  AreaExtensions.simpleNodesOrder(area)

  attachDeletion(editor, area, container, connectionSelection, (nodeId) => !definitions.isProtectedNode(nodeId), (connectionId) => void removeConnectionOrConfirm(connectionId))
  const selectConnectionOnPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0) return
    const wire = event.composedPath().find((item): item is Element =>
      item instanceof Element && item.matches('svg.connection[data-real-connection="true"][data-connection-id]'),
    )
    const connectionId = wire?.getAttribute('data-connection-id')
    if (!connectionId) return
    event.preventDefault()
    event.stopPropagation()
    selectConnection(connectionId)
  }
  // Rete intercepts pointer events on the canvas before a connection SVG's
  // target listener gets them. Capture one level earlier so an existing wire
  // is an interaction target in its own right, rather than a canvas gesture.
  window.addEventListener('pointerdown', selectConnectionOnPointerDown, { capture: true })
  const clearConnectionOnBlankCanvas = (event: PointerEvent): void => {
    if (!(event.target instanceof Element) || event.target.closest('.node, .connection')) return
    connectionSelection.clear()
  }
  container.addEventListener('pointerdown', clearConnectionOnBlankCanvas, { capture: true })

  // Shift+drag rectangle selection on empty canvas (AGENTS.md-adjacent
  // task: multi-selection). Selects through the same `nodeSelection` API
  // click-based selection uses, so marquee-selected nodes participate in
  // group movement/deletion identically.
  const detachMarquee = attachMarqueeSelection(editor, area, container, nodeSelection)

  // Double-click-to-zoom is not part of SCADlet's interaction model (and
  // would fight the Inspect Node feature's own double-click gesture) -
  // wheel/pinch zoom stays, only the dblclick source is disabled.
  area.area.setZoomHandler(new ClicklessZoom(0.1))

  // Rete's zoom extension listens for `wheel` directly on this same
  // `container` element that node controls render inside, so without
  // isolation, e.g. scrolling inside a select's option list also bubbles
  // up and zooms the whole canvas (AGENTS.md section 3).
  isolateControlGestures(container)

  const cancelConnectionOnEscape = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape' || !connectionGesture.active) return
    connection.drop()
    connectionGesture.cancel()
  }
  container.addEventListener('keydown', cancelConnectionOnEscape)

  // Clears presentation timers/state whenever a node is removed, so no
  // stale timer can ever fire and try to update a node that no longer
  // exists (AGENTS.md section 3/15).
  editor.addPipe((context) => {
    if (context.type === 'noderemoved') {
      connectionGesture.removeNode(context.data.id)
      presentation.remove(context.data.id)
      // Restore is transactional: if reconstruction fails it rolls the old
      // graph back. Do not discard its Inspect provenance during those
      // provisional node removals; the application clears it only after a
      // replacement project has committed successfully.
      if (!dirtySuspended) inspect.remove(context.data.id)
      definitions.forgetNode(context.data.id)
    }
    return context
  })

  // Deliberately does NOT call `AreaExtensions.zoomAt`/pan/zoom after
  // creating a node: the previous per-node-type add functions did, which
  // re-framed the whole viewport around every node (jarring, and doubly
  // pointless once nodes get real positions instead of all stacking at
  // (0, 0)). The current pan/zoom must survive node creation unchanged.
  async function fitVisibleContent(): Promise<boolean> {
    const nodeItems: CanvasContentItem[] = editor.getNodes().flatMap((node) => {
      const view = area.nodeViews.get(node.id)
      if (!view) return []
      return [{ x: view.position.x, y: view.position.y, width: view.element.offsetWidth, height: view.element.offsetHeight }]
    })
    const frameItems: CanvasContentItem[] = definitions.list().flatMap((definition) => {
      const bounds = definitionFrameBounds(definitions, definition.id, (nodeId) => area.nodeViews.get(nodeId)?.position)
      return bounds ? [{ x: bounds.minX, y: bounds.minY, width: bounds.maxX - bounds.minX, height: bounds.maxY - bounds.minY }] : []
    })
    const rect = area.container.getBoundingClientRect()
    const transform = fitCanvasBounds(canvasContentBounds([...nodeItems, ...frameItems]), { width: rect.width, height: rect.height })
    if (!transform) return false

    transientViewportChange = true
    try {
      await area.area.zoom(transform.k, 0, 0)
      await area.area.translate(transform.x, transform.y)
      return true
    } finally {
      transientViewportChange = false
    }
  }

  async function setPersistedViewport(viewport: { x: number; y: number; k: number }): Promise<void> {
    transientViewportChange = true
    try {
      await area.area.translate(viewport.x, viewport.y)
      await area.area.zoom(viewport.k, 0, 0)
      // Area.zoom can adjust its translation around the specified origin;
      // restore the exact serialized transform after setting the scale.
      await area.area.translate(viewport.x, viewport.y)
      persistedViewport = { ...viewport }
    } finally {
      transientViewportChange = false
    }
  }

  async function requestTrigonometryOperationChange(nodeId: string, operation: TrigonometryOperation): Promise<boolean> {
    const node = editor.getNode(nodeId)
    if (!(node instanceof TrigonometryNode)) return false
    const previousDirtySuspended = dirtySuspended
    dirtySuspended = true
    const changed = await transitionTrigonometryOperation(editor, node, operation, (count) => {
      try { return window.confirm(t('math.confirmRemoveAtan2Input').replace('{count}', String(count))) } catch { return false }
    }, () => area.update('node', node.id))
    dirtySuspended = previousDirtySuspended
    if (changed && !previousDirtySuspended) notifySemanticDirty()
    return changed
  }

  const creationContext: NodeCreationContext = {
    onControlsChanged: (id) => { void area.update('node', id); notifySemanticDirty() },
    notifyDirty: notifySemanticDirty,
    canRemoveInputs: (nodeId, keys) => !hasConnectedInputs(editor, nodeId, keys),
    getModuleDefinition: (definitionId) => definitions.get(definitionId),
    requestTrigonometryOperationChange,
  }

  async function addModuleParameter(definitionId: string, input: { name: string; type: ModuleParameterType; default: ModuleParameterDefault }): Promise<void> {
    const definition = definitions.get(definitionId)
    if (!definition) throw new Error(`Unknown Module definition "${definitionId}".`)
    const nameProblem = moduleParameterNameProblem(input.name, (definition.parameters ?? []).map((parameter) => parameter.name))
    if (nameProblem) throw new Error(nameProblem === 'duplicate' ? t('definition.duplicateParameter') : t('definition.invalidParameter'))
    const parameter: ModuleParameter = { id: crypto.randomUUID(), name: input.name, type: input.type, default: input.default }
    // Mutation first, then every live projection. All following steps are
    // synchronous structural additions, so calls can never render a partial
    // signature between user actions.
    definitions.addParameter(definitionId, parameter)
    const updated = definitions.get(definitionId)!
    const inputs = editor.getNode(updated.inputsNodeId)
    if (inputs instanceof ModuleInputsNode) {
      inputs.syncSignature(updated.parameters ?? [])
      await area.update('node', inputs.id)
    }
    for (const node of editor.getNodes()) {
      if (!(node instanceof ModuleCallNode) || node.definitionId !== definitionId) continue
      node.syncSignature(updated.parameters ?? [])
      await area.update('node', node.id)
    }
  }

  const signatureConnections = (definition: ModuleDefinition, parameterId: string) => {
    const key = `parameter:${parameterId}`
    return editor.getConnections().filter((connection) =>
      (connection.source === definition.inputsNodeId && connection.sourceOutput === key)
      || (editor.getNode(connection.target) instanceof ModuleCallNode
        && (editor.getNode(connection.target) as ModuleCallNode).definitionId === definition.id
        && connection.targetInput === key),
    )
  }

  async function synchronizeModuleSignature(
    definition: ModuleDefinition,
    resetFallbackIds: ReadonlySet<string> = new Set(),
    fallbackOverrides: ReadonlyMap<string, Readonly<Record<string, ModuleParameterDefault>>> = new Map(),
  ): Promise<void> {
    const inputs = editor.getNode(definition.inputsNodeId)
    if (inputs instanceof ModuleInputsNode) { inputs.syncSignature(definition.parameters ?? []); await area.update('node', inputs.id) }
    for (const node of editor.getNodes()) {
      if (node instanceof ModuleCallNode && node.definitionId === definition.id) {
        node.syncSignature(definition.parameters ?? [], resetFallbackIds, fallbackOverrides.get(node.id))
        await area.update('node', node.id)
      }
    }
  }

  async function editModuleParameter(definitionId: string, parameterId: string, update: { name?: string; type?: ModuleParameterType; default?: ModuleParameterDefault; move?: -1 | 1 }): Promise<boolean> {
    const definition = definitions.get(definitionId)
    const parameters = definition?.parameters ?? []
    const index = parameters.findIndex((parameter) => parameter.id === parameterId)
    if (!definition || index < 0) return false
    const previous = parameters[index]
    const { move, ...changes } = update
    const next = { ...previous, ...changes }
    const typeChanged = next.type !== previous.type
    const nextParameters = [...parameters]
    nextParameters[index] = next
    if (move) {
      const destination = index + move
      if (destination >= 0 && destination < nextParameters.length) {
        const [moved] = nextParameters.splice(index, 1)
        nextParameters.splice(destination, 0, moved)
      }
    }
    const nameProblem = moduleParameterNameProblem(next.name, nextParameters.filter((parameter) => parameter.id !== parameterId).map((parameter) => parameter.name))
    if (nameProblem) throw new Error(nameProblem === 'duplicate' ? t('definition.duplicateParameter') : t('definition.invalidParameter'))
    if (!['number', 'boolean', 'vector3'].includes(next.type) || !moduleParameterDefaultIsValid(next.type, next.default)) throw new Error(t('definition.invalidParameterDefault'))
    const doomed = typeChanged ? signatureConnections(definition, parameterId) : []
    if (doomed.length > 0 && !window.confirm(t('definition.confirmTypeChange').replace('{name}', previous.name).replace('{count}', String(doomed.length)))) return false
    if (doomed.length > 0) {
      connection.drop(); connectionGesture.cancel()
      for (const item of doomed) await editor.removeConnection(item.id)
    }
    definitions.setParameters(definitionId, nextParameters)
    await synchronizeModuleSignature(definitions.get(definitionId)!, typeChanged ? new Set([parameterId]) : new Set())
    return true
  }

  async function deleteModuleParameter(definitionId: string, parameterId: string): Promise<boolean> {
    const definition = definitions.get(definitionId)
    const parameter = definition?.parameters?.find((item) => item.id === parameterId)
    if (!definition || !parameter) throw new Error(t('definition.deleteParameterFailed'))
    const doomed = signatureConnections(definition, parameterId)
    try {
      if (doomed.length > 0 && !window.confirm(t('definition.confirmDeleteParameter').replace('{name}', parameter.name).replace('{count}', String(doomed.length)))) return false
    } catch {
      throw new Error(t('definition.deleteParameterFailed'))
    }
    const key = `parameter:${parameterId}`
    const inputs = editor.getNode(definition.inputsNodeId)
    const calls = editor.getNodes().filter((node): node is ModuleCallNode => node instanceof ModuleCallNode && node.definitionId === definition.id)
    // Validate every live projection before disconnecting anything. This
    // avoids converting a damaged/stale editor state into a partial project.
    if (!(inputs instanceof ModuleInputsNode) || !inputs.outputs[key]
      || calls.some((call) => !call.inputs[key])) throw new Error(t('definition.deleteParameterFailed'))

    const previousParameters = definition.parameters ?? []
    const previousFallbacks = new Map(calls.map((call) => [call.id, call.getArguments()] as const))
    const removedConnections = doomed.map((item) => ({
      id: item.id,
      source: item.source,
      sourceOutput: item.sourceOutput,
      target: item.target,
      targetInput: item.targetInput,
    }))
    const previousDirtySuspended = dirtySuspended
    dirtySuspended = true
    try {
      if (doomed.length > 0) {
        connection.drop()
        connectionGesture.cancel()
        for (const item of doomed) {
          if (!await editor.removeConnection(item.id)) throw new Error(`Could not remove connection ${item.id}.`)
        }
      }
      definitions.setParameters(definitionId, previousParameters.filter((item) => item.id !== parameterId))
      await synchronizeModuleSignature(definitions.get(definitionId)!)
    } catch {
      // Restore the complete preflight snapshot before reporting the error.
      // The stable parameter id keeps every restored port and connection on
      // its original semantic endpoint; saved Call fallbacks are likewise
      // restored rather than being reset to definition defaults.
      try {
        definitions.setParameters(definitionId, previousParameters)
        await synchronizeModuleSignature(definitions.get(definitionId)!, new Set(), previousFallbacks)
        for (const item of removedConnections) {
          if (editor.getConnections().some((connection) => connection.id === item.id)) continue
          const source = editor.getNode(item.source)
          const target = editor.getNode(item.target)
          if (!source || !target) throw new Error(`Could not restore connection ${item.id}.`)
          const restored = new ClassicPreset.Connection(source, item.sourceOutput, target, item.targetInput) as Schemes['Connection']
          restored.id = item.id
          if (!await editor.addConnection(restored)) throw new Error(`Could not restore connection ${item.id}.`)
        }
      } catch {
        // The original operation is still reported through the one existing
        // node-control error surface. All ordinary failures are preflighted,
        // so this is a last-resort guard for unexpected Rete host failures.
      } finally {
        dirtySuspended = previousDirtySuspended
      }
      throw new Error(t('definition.deleteParameterFailed'))
    }
    dirtySuspended = previousDirtySuspended
    if (!previousDirtySuspended) notifySemanticDirty()
    return true
  }

  const geometryInputConnections = (definition: ModuleDefinition, inputId: string) => {
    const key = moduleGeometryInputPortId(inputId)
    return editor.getConnections().filter((connection) =>
      (connection.source === definition.inputsNodeId && connection.sourceOutput === key)
      || (editor.getNode(connection.target) instanceof ModuleCallNode
        && (editor.getNode(connection.target) as ModuleCallNode).definitionId === definition.id
        && connection.targetInput === key),
    )
  }

  async function synchronizeModuleGeometryInputs(definition: ModuleDefinition): Promise<void> {
    const inputs = editor.getNode(definition.inputsNodeId)
    if (inputs instanceof ModuleInputsNode) {
      inputs.syncSignature(definition.parameters ?? [], definition.geometryInputs ?? [])
      await area.update('node', inputs.id)
    }
    for (const node of editor.getNodes()) {
      if (node instanceof ModuleCallNode && node.definitionId === definition.id) {
        node.syncSignature(definition.parameters ?? [], new Set(), {}, definition.geometryInputs ?? [])
        await area.update('node', node.id)
      }
    }
  }

  async function addModuleGeometryInput(definitionId: string, requestedName?: string): Promise<void> {
    const definition = definitions.get(definitionId)
    if (!definition) throw new Error(t('definition.geometryInputFailed'))
    const geometryInputs = definition.geometryInputs ?? []
    const names = new Set(geometryInputs.map((item) => item.name))
    let ordinal = 1; while (names.has(`Geometry ${ordinal}`)) ordinal += 1
    const input: ModuleGeometryInput = { id: crypto.randomUUID(), name: requestedName?.trim() || `Geometry ${ordinal}` }
    if (!input.name) throw new Error(t('definition.geometryInputFailed'))
    if (names.has(input.name)) throw new Error(t('definition.duplicateGeometryInput'))
    definitions.setGeometryInputs(definitionId, [...geometryInputs, input])
    await synchronizeModuleGeometryInputs(definitions.get(definitionId)!)
  }

  async function editModuleGeometryInput(definitionId: string, inputId: string, update: { name?: string; move?: -1 | 1 }): Promise<boolean> {
    const definition = definitions.get(definitionId)
    const inputs = definition?.geometryInputs ?? []
    const index = inputs.findIndex((input) => input.id === inputId)
    if (!definition || index < 0) return false
    const next = [...inputs]
    next[index] = { ...next[index]!, ...(update.name === undefined ? {} : { name: update.name.trim() }) }
    if (!next[index]!.name) throw new Error(t('definition.geometryInputFailed'))
    if (next.some((item, itemIndex) => itemIndex !== index && item.name === next[index]!.name)) throw new Error(t('definition.duplicateGeometryInput'))
    if (update.move) {
      const destination = index + update.move
      if (destination >= 0 && destination < next.length) {
        const [moved] = next.splice(index, 1); next.splice(destination, 0, moved!)
      }
    }
    definitions.setGeometryInputs(definitionId, next)
    await synchronizeModuleGeometryInputs(definitions.get(definitionId)!)
    return true
  }

  async function deleteModuleGeometryInput(definitionId: string, inputId: string): Promise<boolean> {
    const definition = definitions.get(definitionId)
    const input = definition?.geometryInputs?.find((item) => item.id === inputId)
    if (!definition || !input) throw new Error(t('definition.geometryInputFailed'))
    const doomed = geometryInputConnections(definition, inputId)
    if (doomed.length > 0 && !window.confirm(t('definition.confirmDeleteGeometryInput').replace('{name}', input.name).replace('{count}', String(doomed.length)))) return false
    const previous = definition.geometryInputs ?? []
    for (const connection of doomed) if (!await editor.removeConnection(connection.id)) throw new Error(t('definition.geometryInputFailed'))
    definitions.setGeometryInputs(definitionId, previous.filter((item) => item.id !== inputId))
    await synchronizeModuleGeometryInputs(definitions.get(definitionId)!)
    return true
  }

  // ---- Function parameter signature (mirrors the Module parameter
  // functions above; Functions never have Geometry inputs) ----

  async function addFunctionParameter(definitionId: string, input: { name: string; type: ModuleParameterType; default: ModuleParameterDefault }): Promise<void> {
    const definition = definitions.get(definitionId)
    if (!definition) throw new Error(`Unknown Function definition "${definitionId}".`)
    const nameProblem = moduleParameterNameProblem(input.name, (definition.parameters ?? []).map((parameter) => parameter.name))
    if (nameProblem) throw new Error(nameProblem === 'duplicate' ? t('definition.duplicateFunctionParameter') : t('definition.invalidParameter'))
    const parameter: ModuleParameter = { id: crypto.randomUUID(), name: input.name, type: input.type, default: input.default }
    definitions.addParameter(definitionId, parameter)
    const updated = definitions.get(definitionId)!
    const inputs = editor.getNode(updated.inputsNodeId)
    if (inputs instanceof FunctionInputsNode) {
      inputs.syncSignature(updated.parameters ?? [])
      await area.update('node', inputs.id)
    }
    for (const node of editor.getNodes()) {
      if (!(node instanceof FunctionCallNode) || node.definitionId !== definitionId) continue
      node.syncSignature(updated.parameters ?? [])
      await area.update('node', node.id)
    }
  }

  const functionSignatureConnections = (definition: ModuleDefinition, parameterId: string) => {
    const key = moduleParameterPortId(parameterId)
    return editor.getConnections().filter((connection) =>
      (connection.source === definition.inputsNodeId && connection.sourceOutput === key)
      || (editor.getNode(connection.target) instanceof FunctionCallNode
        && (editor.getNode(connection.target) as FunctionCallNode).definitionId === definition.id
        && connection.targetInput === key),
    )
  }

  async function synchronizeFunctionSignature(
    definition: ModuleDefinition,
    resetFallbackIds: ReadonlySet<string> = new Set(),
    fallbackOverrides: ReadonlyMap<string, Readonly<Record<string, ModuleParameterDefault>>> = new Map(),
  ): Promise<void> {
    const inputs = editor.getNode(definition.inputsNodeId)
    if (inputs instanceof FunctionInputsNode) { inputs.syncSignature(definition.parameters ?? []); await area.update('node', inputs.id) }
    for (const node of editor.getNodes()) {
      if (node instanceof FunctionCallNode && node.definitionId === definition.id) {
        node.syncSignature(definition.parameters ?? [], resetFallbackIds, fallbackOverrides.get(node.id))
        await area.update('node', node.id)
      }
    }
  }

  async function editFunctionParameter(definitionId: string, parameterId: string, update: { name?: string; type?: ModuleParameterType; default?: ModuleParameterDefault; move?: -1 | 1 }): Promise<boolean> {
    const definition = definitions.get(definitionId)
    const parameters = definition?.parameters ?? []
    const index = parameters.findIndex((parameter) => parameter.id === parameterId)
    if (!definition || index < 0) return false
    const previous = parameters[index]
    const { move, ...changes } = update
    const next = { ...previous, ...changes }
    const typeChanged = next.type !== previous.type
    const nextParameters = [...parameters]
    nextParameters[index] = next
    if (move) {
      const destination = index + move
      if (destination >= 0 && destination < nextParameters.length) {
        const [moved] = nextParameters.splice(index, 1)
        nextParameters.splice(destination, 0, moved)
      }
    }
    const nameProblem = moduleParameterNameProblem(next.name, nextParameters.filter((parameter) => parameter.id !== parameterId).map((parameter) => parameter.name))
    if (nameProblem) throw new Error(nameProblem === 'duplicate' ? t('definition.duplicateFunctionParameter') : t('definition.invalidParameter'))
    if (!['number', 'boolean', 'vector3'].includes(next.type) || !moduleParameterDefaultIsValid(next.type, next.default)) throw new Error(t('definition.invalidParameterDefault'))
    const doomed = typeChanged ? functionSignatureConnections(definition, parameterId) : []
    if (doomed.length > 0 && !window.confirm(t('definition.confirmTypeChange').replace('{name}', previous.name).replace('{count}', String(doomed.length)))) return false
    if (doomed.length > 0) {
      connection.drop(); connectionGesture.cancel()
      for (const item of doomed) await editor.removeConnection(item.id)
    }
    definitions.setParameters(definitionId, nextParameters)
    await synchronizeFunctionSignature(definitions.get(definitionId)!, typeChanged ? new Set([parameterId]) : new Set())
    return true
  }

  async function deleteFunctionParameter(definitionId: string, parameterId: string): Promise<boolean> {
    const definition = definitions.get(definitionId)
    const parameter = definition?.parameters?.find((item) => item.id === parameterId)
    if (!definition || !parameter) throw new Error(t('definition.deleteParameterFailed'))
    const doomed = functionSignatureConnections(definition, parameterId)
    try {
      if (doomed.length > 0 && !window.confirm(t('definition.confirmDeleteParameter').replace('{name}', parameter.name).replace('{count}', String(doomed.length)))) return false
    } catch {
      throw new Error(t('definition.deleteParameterFailed'))
    }
    const key = moduleParameterPortId(parameterId)
    const inputs = editor.getNode(definition.inputsNodeId)
    const calls = editor.getNodes().filter((node): node is FunctionCallNode => node instanceof FunctionCallNode && node.definitionId === definition.id)
    if (!(inputs instanceof FunctionInputsNode) || !inputs.outputs[key]
      || calls.some((call) => !call.inputs[key])) throw new Error(t('definition.deleteParameterFailed'))

    const previousParameters = definition.parameters ?? []
    const previousDirtySuspended = dirtySuspended
    dirtySuspended = true
    try {
      if (doomed.length > 0) {
        connection.drop()
        connectionGesture.cancel()
        for (const item of doomed) {
          if (!await editor.removeConnection(item.id)) throw new Error(`Could not remove connection ${item.id}.`)
        }
      }
      definitions.setParameters(definitionId, previousParameters.filter((item) => item.id !== parameterId))
      await synchronizeFunctionSignature(definitions.get(definitionId)!)
    } catch {
      dirtySuspended = previousDirtySuspended
      throw new Error(t('definition.deleteParameterFailed'))
    }
    dirtySuspended = previousDirtySuspended
    if (!previousDirtySuspended) notifySemanticDirty()
    return true
  }

  // ---- Function result type: inference, controlled replacement, and
  // unresolve-on-disconnect (AGENTS.md Milestone 8 Phase 7, sections 3-4)
  // ----

  interface FunctionResultTransitionPlan {
    resultTypes: Map<string, FunctionResultType | undefined>
    doomedConnections: Schemes['Connection'][]
  }

  /** Propagates a result transition through nested Calls. A typed Call wired
   * directly to another Function Output remains connected and changes that
   * caller's result type; fixed incompatible inputs are disconnected. An
   * unresolved callee disconnects all of its Call outputs and recursively
   * unresolves callers whose sole result wire was one of them. */
  function planFunctionResultTransitions(initial: ReadonlyMap<string, FunctionResultType | undefined>): FunctionResultTransitionPlan {
    const resultTypes = new Map<string, FunctionResultType | undefined>()
    const doomed = new Map<string, Schemes['Connection']>()
    const pending = [...initial]
    while (pending.length > 0) {
      const [definitionId, nextType] = pending.shift()!
      if (resultTypes.has(definitionId) && resultTypes.get(definitionId) === nextType) continue
      resultTypes.set(definitionId, nextType)
      const callIds = new Set(editor.getNodes()
        .filter((node) => node instanceof FunctionCallNode && node.definitionId === definitionId)
        .map((node) => node.id))
      for (const item of editor.getConnections().filter((connection) => callIds.has(connection.source) && connection.sourceOutput === 'value')) {
        const target = editor.getNode(item.target)
        if (target instanceof FunctionOutputNode && item.targetInput === 'result') {
          const callerId = definitions.scopeOf(target.id)
          const caller = callerId ? definitions.get(callerId) : undefined
          if (caller?.kind === 'function' && nextType !== undefined) {
            pending.push([caller.id, nextType])
            continue
          }
          doomed.set(item.id, item)
          if (caller?.kind === 'function') pending.push([caller.id, undefined])
          continue
        }
        const targetType = socketType(target?.inputs[item.targetInput]?.socket)
        if (nextType === undefined || targetType !== nextType) doomed.set(item.id, item)
      }
    }
    return { resultTypes, doomedConnections: [...doomed.values()] }
  }

  /** Applies an already-decided result type (or `undefined` to unresolve) to
   * the Function Output port and every Call's output port. Callers must
   * have already removed any now-incompatible connections. */
  async function applyFunctionResultType(definitionId: string, resultType: FunctionResultType | undefined): Promise<void> {
    definitions.setResultType(definitionId, resultType)
    const definition = definitions.get(definitionId)!
    const output = editor.getNode(definition.outputNodeId)
    if (output instanceof FunctionOutputNode) { output.setResultType(resultType); await area.update('node', output.id) }
    for (const node of editor.getNodes()) {
      if (node instanceof FunctionCallNode && node.definitionId === definitionId) {
        node.setResultType(resultType)
        await area.update('node', node.id)
      }
    }
  }

  async function applyFunctionResultTransitions(plan: FunctionResultTransitionPlan): Promise<void> {
    for (const [definitionId, resultType] of plan.resultTypes) await applyFunctionResultType(definitionId, resultType)
  }

  /** Runs entirely inside the `connectioncreate` pre-signal so a cancelled
   * replacement never lets Rete add the new wire at all - the previous
   * connection, inferred type, Calls, and generated source stay untouched.
   * Async so every removal (and the resulting socket swap) completes before
   * Rete is allowed to add the new connection - `FunctionOutputNode`'s own
   * port-removal guard (`guardPortRemoval`) would otherwise reject a
   * same-tick `removeInput('result')` race against the not-yet-resolved
   * old-connection removal. */
  async function handleFunctionResultConnectionAttempt(data: { source: string; sourceOutput: string; target: string; targetInput: string }): Promise<boolean> {
    const definitionId = definitions.scopeOf(data.target)
    const definition = definitionId ? definitions.get(definitionId) : undefined
    if (!definition || definition.kind !== 'function') return false
    const sourceSocket = editor.getNode(data.source)?.outputs[data.sourceOutput]?.socket
    const newType = socketType(sourceSocket)
    if (newType !== 'number' && newType !== 'boolean' && newType !== 'vector3') return false
    const previousType = definition.resultType
    const oldResultConnections = editor.getConnections().filter((item) => item.target === data.target && item.targetInput === 'result')
    const plan = previousType !== newType
      ? planFunctionResultTransitions(new Map([[definition.id, newType]]))
      : { resultTypes: new Map<string, FunctionResultType | undefined>(), doomedConnections: [] }
    if (plan.doomedConnections.length > 0) {
      let confirmed: boolean
      try {
        confirmed = window.confirm(t('definition.confirmFunctionResultTypeChange').replace('{name}', definition.name).replace('{count}', String(plan.doomedConnections.length)))
      } catch {
        return false
      }
      if (!confirmed) return false
    }
    const previousDirtySuspended = dirtySuspended
    dirtySuspended = true
    const removed: Schemes['Connection'][] = []
    const previousTypes = new Map([...plan.resultTypes].map(([id]) => [id, definitions.get(id)?.resultType] as const))
    try {
      for (const item of [...oldResultConnections, ...plan.doomedConnections]) {
        if (removed.some((candidate) => candidate.id === item.id)) continue
        if (!await editor.removeConnection(item.id)) throw new Error(`Could not remove connection ${item.id}.`)
        removed.push(item)
      }
      if (previousType !== newType) await applyFunctionResultTransitions(plan)
    } catch {
      for (const [id, type] of previousTypes) await applyFunctionResultType(id, type)
      for (const item of removed) if (!editor.getConnections().some((candidate) => candidate.id === item.id)) await editor.addConnection(item)
      dirtySuspended = previousDirtySuspended
      return false
    }
    dirtySuspended = previousDirtySuspended
    if (!previousDirtySuspended) notifySemanticDirty()
    return true
  }

  /** Conditional branch inference mirrors Function Output's narrow
   * transition protocol. The ports themselves keep their semantic IDs; only
   * their socket instances change after every incompatible endpoint has been
   * preflighted and (if necessary) confirmed. */
  async function handleConditionalBranchConnectionAttempt(data: { source: string; sourceOutput: string; target: string; targetInput: string }): Promise<boolean> {
    const conditional = editor.getNode(data.target)
    if (!(conditional instanceof ConditionalNode) || (data.targetInput !== 'true' && data.targetInput !== 'false')) return false
    const nextType = socketType(editor.getNode(data.source)?.outputs[data.sourceOutput]?.socket)
    if (nextType !== 'number' && nextType !== 'boolean' && nextType !== 'vector3') return false
    const previousType = conditional.getValueType()
    const replacing = editor.getConnections().filter((item) => item.target === data.target && item.targetInput === data.targetInput)
    const doomed = new Map<string, Schemes['Connection']>()
    if (previousType !== nextType) {
      const opposite = data.targetInput === 'true' ? 'false' : 'true'
      for (const item of editor.getConnections()) {
        if (item.target === data.target && item.targetInput === opposite) {
          const type = socketType(editor.getNode(item.source)?.outputs[item.sourceOutput]?.socket)
          if (type !== nextType) doomed.set(item.id, item)
        }
        if (item.source === data.target && item.sourceOutput === 'result') {
          const type = socketType(editor.getNode(item.target)?.inputs[item.targetInput]?.socket)
          if (type !== nextType) doomed.set(item.id, item)
        }
      }
    }
    if (doomed.size > 0) {
      let confirmed: boolean
      try { confirmed = window.confirm(t('conditional.confirmTypeChange').replace('{type}', nextType).replace('{count}', String(doomed.size))) } catch { return false }
      if (!confirmed) return false
    }
    const previousDirtySuspended = dirtySuspended
    dirtySuspended = true
    const removed: Schemes['Connection'][] = []
    try {
      for (const item of [...replacing, ...doomed.values()]) {
        if (removed.some((candidate) => candidate.id === item.id)) continue
        if (!await editor.removeConnection(item.id)) throw new Error(`Could not remove connection ${item.id}.`)
        removed.push(item)
      }
      if (previousType !== nextType) {
        conditional.setValueType(nextType)
        await area.update('node', conditional.id)
      }
    } catch {
      conditional.setValueType(previousType)
      await area.update('node', conditional.id)
      for (const item of removed) if (!editor.getConnections().some((candidate) => candidate.id === item.id)) await editor.addConnection(item)
      dirtySuspended = previousDirtySuspended
      return false
    }
    dirtySuspended = previousDirtySuspended
    if (!previousDirtySuspended) notifySemanticDirty()
    return true
  }

  /** Routes ordinary connection deletion (Delete/Backspace on a selected
   * wire) through the Function unresolve flow only for the one connection
   * that matters: the sole wire into a Function Output's `result` port.
   * Every other connection deletes exactly as before. */
  async function removeConnectionOrConfirm(connectionId: string): Promise<void> {
    const target = editor.getConnections().find((item) => item.id === connectionId)
    const targetNode = target ? editor.getNode(target.target) : undefined
    if (target && targetNode instanceof ConditionalNode && (target.targetInput === 'true' || target.targetInput === 'false')) {
      const otherBranchesRemain = editor.getConnections().some((item) => item.id !== connectionId && item.target === target.target && (item.targetInput === 'true' || item.targetInput === 'false'))
      if (otherBranchesRemain) {
        await editor.removeConnection(connectionId)
        return
      }
      const doomed = editor.getConnections().filter((item) => item.source === target.target && item.sourceOutput === 'result')
      if (doomed.length > 0) {
        let confirmed: boolean
        try { confirmed = window.confirm(t('conditional.confirmUnresolve').replace('{count}', String(doomed.length))) } catch { return }
        if (!confirmed) return
      }
      const previousType = targetNode.getValueType()
      const previousDirtySuspended = dirtySuspended
      dirtySuspended = true
      const removed: Schemes['Connection'][] = []
      try {
        for (const item of [target, ...doomed]) {
          if (!await editor.removeConnection(item.id)) throw new Error(`Could not remove connection ${item.id}.`)
          removed.push(item)
        }
        targetNode.setValueType(undefined)
        await area.update('node', targetNode.id)
      } catch {
        targetNode.setValueType(previousType)
        await area.update('node', targetNode.id)
        for (const item of removed) if (!editor.getConnections().some((candidate) => candidate.id === item.id)) await editor.addConnection(item)
        dirtySuspended = previousDirtySuspended
        return
      }
      dirtySuspended = previousDirtySuspended
      if (!previousDirtySuspended) notifySemanticDirty()
      return
    }
    if (!target || !(targetNode instanceof FunctionOutputNode) || target.targetInput !== 'result') {
      await editor.removeConnection(connectionId)
      return
    }
    const definitionId = definitions.scopeOf(target.target)
    const definition = definitionId ? definitions.get(definitionId) : undefined
    if (!definition || definition.kind !== 'function') {
      await editor.removeConnection(connectionId)
      return
    }
    const remainingAfterRemoval = editor.getConnections().some((item) => item.id !== connectionId && item.target === target.target && item.targetInput === 'result')
    if (remainingAfterRemoval) {
      await editor.removeConnection(connectionId)
      return
    }
    const plan = planFunctionResultTransitions(new Map([[definition.id, undefined]]))
    if (plan.doomedConnections.length > 0) {
      let confirmed: boolean
      try {
        confirmed = window.confirm(t('definition.confirmFunctionUnresolve').replace('{name}', definition.name).replace('{count}', String(plan.doomedConnections.length)))
      } catch {
        return
      }
      if (!confirmed) return
    }
    const previousDirtySuspended = dirtySuspended
    dirtySuspended = true
    const removed: Schemes['Connection'][] = []
    const previousTypes = new Map([...plan.resultTypes].map(([id]) => [id, definitions.get(id)?.resultType] as const))
    try {
      for (const item of [target, ...plan.doomedConnections]) {
        if (removed.some((candidate) => candidate.id === item.id)) continue
        if (!await editor.removeConnection(item.id)) throw new Error(`Could not remove connection ${item.id}.`)
        removed.push(item)
      }
      await applyFunctionResultTransitions(plan)
    } catch {
      for (const [id, type] of previousTypes) await applyFunctionResultType(id, type)
      for (const item of removed) if (!editor.getConnections().some((candidate) => candidate.id === item.id)) await editor.addConnection(item)
      dirtySuspended = previousDirtySuspended
      return
    }
    dirtySuspended = previousDirtySuspended
    if (!previousDirtySuspended) notifySemanticDirty()
  }

  const definitionAt = (clientPosition: Position): string | null => {
    const rect = area.container.getBoundingClientRect()
    const graphPosition = clientToGraphPosition(clientPosition, rect, area.area.transform)
    // Later frames paint on top, so use reverse project ordering for the
    // equally visible overlapping-frame case.
    for (const definition of [...definitions.list()].reverse()) {
      const bounds = definitionFrameBounds(definitions, definition.id, (id) => area.nodeViews.get(id)?.position)
      if (bounds && graphPosition.x >= bounds.minX && graphPosition.x <= bounds.maxX && graphPosition.y >= bounds.minY && graphPosition.y <= bounds.maxY) {
        return definition.id
      }
    }
    return null
  }

  const pointIsInsideDefinitionFrame = (graphPosition: Position, bounds: DefinitionFrameBounds): boolean =>
    graphPosition.x >= bounds.minX && graphPosition.x <= bounds.maxX
      && graphPosition.y >= bounds.minY && graphPosition.y <= bounds.maxY

  const definitionAtGraphPosition = (graphPosition: Position, sourceFrameBounds: ReadonlyMap<string, DefinitionFrameBounds> = new Map()): string | null => {
    // A different definition is the intended destination when frames overlap.
    // Check those current (and therefore target) bounds before the frozen
    // source bounds so an outgoing node can enter another Module directly.
    for (const definition of [...definitions.list()].reverse()) {
      if (sourceFrameBounds.has(definition.id)) continue
      const bounds = definitionFrameBounds(definitions, definition.id, (id) => area.nodeViews.get(id)?.position)
      if (bounds && pointIsInsideDefinitionFrame(graphPosition, bounds)) return definition.id
    }
    for (const definition of [...definitions.list()].reverse()) {
      const bounds = sourceFrameBounds.get(definition.id)
      if (bounds && pointIsInsideDefinitionFrame(graphPosition, bounds)) return definition.id
    }
    return null
  }

  const feedback = document.createElement('div')
  feedback.className = 'editor-feedback'
  feedback.hidden = true
  container.appendChild(feedback)
  let feedbackTimer: number | undefined
  const showFeedback = (key: string): void => {
    feedback.textContent = t(key)
    feedback.hidden = false
    if (feedbackTimer !== undefined) window.clearTimeout(feedbackTimer)
    feedbackTimer = window.setTimeout(() => { feedback.hidden = true }, 3500)
  }
  showScopeTransferFeedback = (problem: ScopeTransferProblem): void => {
    showFeedback(
      problem === 'module-call' ? 'definition.moduleCallsMainOnly'
        : problem === 'function-incompatible' ? 'definition.functionScopeIncompatible'
          : 'definition.invalidScopeTransfer',
    )
  }
  showDataflowCycleFeedback = () => showFeedback('connection.dataflowCycle')
  const updateScopeDestination = (graphPosition: Position): void => {
    if (!activeScopeDrag) return
    const definitionId = definitionAtGraphPosition(graphPosition, activeScopeDrag.sourceFrameBounds)
    if (!definitionId) {
      scopeDestination = null
      return
    }
    scopeDestination = {
      definitionId,
      valid: scopeTransferProblem(editor, definitions, activeScopeDrag.nodeIds, definitionId) === null,
    }
  }
  area.addPipe((context) => {
    if (context.type === 'nodepicked') {
      const nodeIds = editor.getNodes().filter((node) => node.selected).map((node) => node.id)
      // A selected group moves as the one atomic transaction; an unselected
      // node being picked is included even if Rete selection settles later.
      if (!nodeIds.includes(context.data.id)) nodeIds.push(context.data.id)
      // Permanent definition interfaces still move normally with Rete, but
      // never enter the ordinary transferable-node gesture at all.
      if (nodeIds.some((nodeId) => definitions.isProtectedNode(nodeId))) return context
      const sourceFrameBounds = new Map<string, DefinitionFrameBounds>()
      for (const definitionId of new Set(nodeIds.map((nodeId) => definitions.scopeOf(nodeId)).filter((id): id is string => id !== null))) {
        const bounds = definitionFrameBounds(definitions, definitionId, (id) => area.nodeViews.get(id)?.position)
        if (bounds) sourceFrameBounds.set(definitionId, bounds)
      }
      activeScopeDrag = {
        nodeIds,
        startPositions: new Map(nodeIds.flatMap((id) => {
          const position = area.nodeViews.get(id)?.position
          return position ? [[id, { ...position }] as const] : []
        })),
        sourceFrameBounds,
        moved: false,
      }
    } else if (context.type === 'nodetranslated' && activeScopeDrag?.nodeIds.includes(context.data.id)) {
      activeScopeDrag.moved = true
    } else if (context.type === 'pointermove' && activeScopeDrag) {
      updateScopeDestination(context.data.position)
    } else if (context.type === 'pointerup' && activeScopeDrag) {
      const drag = activeScopeDrag
      const targetScope = definitionAtGraphPosition(context.data.position, drag.sourceFrameBounds)
      const changingScope = drag.moved && drag.nodeIds.some((nodeId) => definitions.scopeOf(nodeId) !== targetScope)
      let problem = changingScope ? scopeTransferProblem(editor, definitions, drag.nodeIds, targetScope) : null
      scopeDestination = null
      if (changingScope && problem) {
        void Promise.all([...drag.startPositions].map(([nodeId, position]) => area.translate(nodeId, position))).then(() => {
          if (activeScopeDrag === drag) {
            activeScopeDrag = null
            // The rollback completes after the pointerup frame has rendered,
            // so explicitly schedule one more frame with live bounds.
            void area.update('node', drag.nodeIds[0])
          }
          showScopeTransferFeedback(problem)
        })
      } else {
        activeScopeDrag = null
        if (changingScope) definitions.setNodeScopes(drag.nodeIds, targetScope)
        else if (drag.moved) notifyDirty()
      }
    }
    return context
  })

  async function addNodeAt(type: string, clientPosition: Position, params?: Record<string, unknown>, scope: string | null | undefined = undefined): Promise<void> {
    const entry = findCatalogEntry(type)
    if (!entry) return

    // Palette click supplies Main explicitly; palette drag may assign a
    // Module/Function scope exactly once from its creation-time frame hit
    // test. A Function's graph may only ever contain its own closed
    // value-expression vocabulary (AGENTS.md Milestone 8 Phase 7, section 6)
    // - reject before ever constructing/adding the incompatible node.
    const owner = scope === undefined ? definitionAt(clientPosition) : scope
    if (owner !== null && definitions.get(owner)?.kind === 'function' && !FUNCTION_GRAPH_ALLOWED_NODE_TYPES.has(type as NodeTypeId)) {
      showScopeTransferFeedback('function-incompatible')
      return
    }

    let validatedParams: Record<string, unknown> | undefined
    try { validatedParams = params === undefined ? undefined : entry.validateParams(params) } catch { return }
    const node = entry.create(creationContext, validatedParams)
    if (owner !== null) definitions.assignNode(owner, node.id)
    await editor.addNode(node)

    const rect = area.container.getBoundingClientRect()
    const position = clientToGraphPosition(clientPosition, rect, area.area.transform)
    await area.translate(node.id, position)
  }

  async function addModuleCallAt(definitionId: string, clientPosition: Position): Promise<boolean> {
    const owner = definitionAt(clientPosition)
    if (!definitions.get(definitionId) || (owner !== null && definitions.get(owner)?.kind === 'function')) return false
    const entry = findCatalogEntry('module-call')!
    const node = entry.create(creationContext, { definitionId })
    if (owner !== null) definitions.assignNode(owner, node.id)
    await editor.addNode(node)
    const rect = area.container.getBoundingClientRect()
    await area.translate(node.id, clientToGraphPosition(clientPosition, rect, area.area.transform))
    return true
  }

  async function createModule(name: string): Promise<ModuleDefinition> {
    const normalized = name.trim()
    const problem = moduleNameProblem(normalized, definitions.list().map((definition) => definition.name))
    if (problem === 'duplicate') throw new Error(t('definition.duplicateName'))
    if (problem) throw new Error(t('definition.invalidName'))

    const definition: ModuleDefinition = {
      id: crypto.randomUUID(),
      kind: 'module',
      name: normalized,
      inputsNodeId: crypto.randomUUID(),
      outputNodeId: crypto.randomUUID(),
      parameters: [],
      geometryInputs: [],
    }
    definition.geometryInputs = [defaultModuleGeometryInput(definition.id)]
    definitions.add(definition)
    const inputs = new ModuleInputsNode(definition.parameters, definition.geometryInputs)
    inputs.id = definition.inputsNodeId
    const output = new ModuleOutputNode()
    output.id = definition.outputNodeId
    await editor.addNode(inputs)
    await editor.addNode(output)
    const rect = area.container.getBoundingClientRect()
    const center = clientToGraphPosition(
      { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 },
      rect,
      area.area.transform,
    )
    await area.translate(inputs.id, { x: center.x - 230, y: center.y - 30 })
    await area.translate(output.id, { x: center.x + 90, y: center.y - 30 })
    return definition
  }

  async function renameModule(definitionId: string, rawName: string): Promise<boolean> {
    const definition = definitions.get(definitionId)
    if (!definition) throw new Error(t('definition.renameFailed'))
    const name = rawName.trim()
    const problem = moduleNameProblem(name, definitions.list().filter((item) => item.id !== definitionId).map((item) => item.name))
    if (problem === 'duplicate') throw new Error(t('definition.duplicateName'))
    if (problem) throw new Error(t('definition.invalidName'))
    if (name === definition.name) return false
    const calls = editor.getNodes().filter((node): node is ModuleCallNode => node instanceof ModuleCallNode && node.definitionId === definitionId)
    definitions.rename(definitionId, name)
    for (const call of calls) {
      call.syncDefinitionName(name)
      await area.update('node', call.id)
    }
    return true
  }

  async function deleteModule(definitionId: string): Promise<boolean> {
    const definition = definitions.get(definitionId)
    if (!definition) throw new Error(t('definition.deleteModuleFailed'))
    const memberIds = definitions.nodeIds(definitionId)
    const calls = editor.getNodes().filter((node): node is ModuleCallNode => node instanceof ModuleCallNode && node.definitionId === definitionId)
    const nodeIds = new Set([...memberIds, ...calls.map((call) => call.id)])
    if (memberIds.some((id) => !editor.getNode(id)) || calls.some((call) => !editor.getNode(call.id))) throw new Error(t('definition.deleteModuleFailed'))
    const connections = editor.getConnections().filter((connection) => nodeIds.has(connection.source) || nodeIds.has(connection.target))
    const message = t('definition.confirmDeleteModule')
      .replace('{name}', definition.name)
      .replace('{calls}', String(calls.length))
      .replace('{connections}', String(connections.length))
    try { if (!window.confirm(message)) return false } catch { throw new Error(t('definition.deleteModuleFailed')) }
    const previousDirtySuspended = dirtySuspended
    dirtySuspended = true
    const removedConnections: Schemes['Connection'][] = []
    const removedNodes: { node: Schemes['Node']; scope: string | null; pinned: boolean; position?: Position }[] = []
    try {
      connection.drop(); connectionGesture.cancel()
      for (const item of connections) {
        if (!await editor.removeConnection(item.id)) throw new Error(`Could not remove connection ${item.id}.`)
        removedConnections.push(item)
      }
      for (const nodeId of nodeIds) {
        const node = editor.getNode(nodeId)!
        const position = area.nodeViews.get(nodeId)?.position
        removedNodes.push({ node, scope: definitions.scopeOf(nodeId), pinned: presentation.isPinned(nodeId), ...(position ? { position: { ...position } } : {}) })
        if (!await editor.removeNode(nodeId)) throw new Error(`Could not remove node ${nodeId}.`)
      }
      definitions.remove(definitionId)
    } catch {
      for (const item of removedNodes) {
        if (editor.getNode(item.node.id)) continue
        if (item.scope && definitions.get(item.scope) && !definitions.isProtectedNode(item.node.id)) definitions.assignNode(item.scope, item.node.id)
        await editor.addNode(item.node)
        if (item.position) await area.translate(item.node.id, item.position)
        if (item.pinned && !presentation.isPinned(item.node.id)) presentation.togglePin(item.node.id)
      }
      for (const item of removedConnections) if (!editor.getConnections().some((candidate) => candidate.id === item.id)) await editor.addConnection(item)
      dirtySuspended = previousDirtySuspended
      throw new Error(t('definition.deleteModuleFailed'))
    }
    dirtySuspended = previousDirtySuspended
    if (!previousDirtySuspended) notifySemanticDirty()
    return true
  }

  async function addFunctionCallAt(definitionId: string, clientPosition: Position): Promise<boolean> {
    const definition = definitions.get(definitionId)
    const owner = definitionAt(clientPosition)
    if (!definition || definition.kind !== 'function' || !definition.resultType
      || (owner !== null && definitions.get(owner)?.kind !== 'function' && definitions.get(owner)?.kind !== 'module')) return false
    const entry = findCatalogEntry('function-call')!
    const node = entry.create(creationContext, { definitionId })
    if (owner !== null) definitions.assignNode(owner, node.id)
    await editor.addNode(node)
    const rect = area.container.getBoundingClientRect()
    await area.translate(node.id, clientToGraphPosition(clientPosition, rect, area.area.transform))
    return true
  }

  async function createFunction(name: string): Promise<ModuleDefinition> {
    const normalized = name.trim()
    const problem = moduleNameProblem(normalized, definitions.list().map((definition) => definition.name))
    if (problem === 'duplicate') throw new Error(t('definition.duplicateName'))
    if (problem) throw new Error(t('definition.invalidName'))

    const definition: ModuleDefinition = {
      id: crypto.randomUUID(),
      kind: 'function',
      name: normalized,
      inputsNodeId: crypto.randomUUID(),
      outputNodeId: crypto.randomUUID(),
      parameters: [],
    }
    definitions.add(definition)
    const inputs = new FunctionInputsNode(definition.parameters)
    inputs.id = definition.inputsNodeId
    const output = new FunctionOutputNode()
    output.id = definition.outputNodeId
    await editor.addNode(inputs)
    await editor.addNode(output)
    const rect = area.container.getBoundingClientRect()
    const center = clientToGraphPosition(
      { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 },
      rect,
      area.area.transform,
    )
    await area.translate(inputs.id, { x: center.x - 230, y: center.y - 30 })
    await area.translate(output.id, { x: center.x + 90, y: center.y - 30 })
    return definition
  }

  async function renameFunction(definitionId: string, rawName: string): Promise<boolean> {
    const definition = definitions.get(definitionId)
    if (!definition) throw new Error(t('definition.renameFailed'))
    const name = rawName.trim()
    const problem = moduleNameProblem(name, definitions.list().filter((item) => item.id !== definitionId).map((item) => item.name))
    if (problem === 'duplicate') throw new Error(t('definition.duplicateName'))
    if (problem) throw new Error(t('definition.invalidName'))
    if (name === definition.name) return false
    const calls = editor.getNodes().filter((node): node is FunctionCallNode => node instanceof FunctionCallNode && node.definitionId === definitionId)
    definitions.rename(definitionId, name)
    for (const call of calls) {
      call.syncDefinitionName(name)
      await area.update('node', call.id)
    }
    return true
  }

  async function deleteFunction(definitionId: string): Promise<boolean> {
    const definition = definitions.get(definitionId)
    if (!definition) throw new Error(t('definition.deleteFunctionFailed'))
    const memberIds = definitions.nodeIds(definitionId)
    const calls = editor.getNodes().filter((node): node is FunctionCallNode => node instanceof FunctionCallNode && node.definitionId === definitionId)
    const nodeIds = new Set([...memberIds, ...calls.map((call) => call.id)])
    if (memberIds.some((id) => !editor.getNode(id)) || calls.some((call) => !editor.getNode(call.id))) throw new Error(t('definition.deleteFunctionFailed'))
    // Every effective caller becomes an unresolved draft, including callers
    // that reach the deleted Call through Arithmetic/Conditional rather than
    // wiring it directly into Function Output. Walk the reverse dependency
    // closure before mutation so recursive peers and their callers are
    // handled as one atomic lifecycle transaction.
    const dependencyAnalysis = definitionDependencies()
    const affectedCallers = new Map<string, FunctionResultType | undefined>()
    const pendingDeletedDependencies = [definitionId]
    while (pendingDeletedDependencies.length > 0) {
      const removedDependency = pendingDeletedDependencies.shift()!
      for (const candidate of definitions.list()) {
        if (candidate.kind !== 'function' || candidate.id === definitionId || affectedCallers.has(candidate.id)) continue
        if (dependencyAnalysis.dependencies.get(candidate.id)?.has(removedDependency)) {
          affectedCallers.set(candidate.id, undefined)
          pendingDeletedDependencies.push(candidate.id)
        }
      }
    }
    const transitionPlan = planFunctionResultTransitions(affectedCallers)
    const affectedOutputConnections = [...transitionPlan.resultTypes]
      .filter(([id, resultType]) => id !== definitionId && resultType === undefined)
      .flatMap(([id]) => {
        const outputNodeId = definitions.get(id)?.outputNodeId
        return outputNodeId
          ? editor.getConnections().filter((item) => item.target === outputNodeId && item.targetInput === 'result')
          : []
      })
    const connections = [...new Map(editor.getConnections()
      .filter((item) => nodeIds.has(item.source) || nodeIds.has(item.target)
        || transitionPlan.doomedConnections.some((doomed) => doomed.id === item.id)
        || affectedOutputConnections.some((output) => output.id === item.id))
      .map((item) => [item.id, item])).values()]
    const message = t('definition.confirmDeleteFunction')
      .replace('{name}', definition.name)
      .replace('{calls}', String(calls.length))
      .replace('{connections}', String(connections.length))
    try { if (!window.confirm(message)) return false } catch { throw new Error(t('definition.deleteFunctionFailed')) }
    const previousDirtySuspended = dirtySuspended
    dirtySuspended = true
    const removedConnections: Schemes['Connection'][] = []
    const removedNodes: { node: Schemes['Node']; scope: string | null; pinned: boolean; position?: Position }[] = []
    const previousTypes = new Map([...transitionPlan.resultTypes].map(([id]) => [id, definitions.get(id)?.resultType] as const))
    try {
      connection.drop(); connectionGesture.cancel()
      for (const item of connections) {
        if (!await editor.removeConnection(item.id)) throw new Error(`Could not remove connection ${item.id}.`)
        removedConnections.push(item)
      }
      for (const nodeId of nodeIds) {
        const node = editor.getNode(nodeId)!
        const position = area.nodeViews.get(nodeId)?.position
        removedNodes.push({ node, scope: definitions.scopeOf(nodeId), pinned: presentation.isPinned(nodeId), ...(position ? { position: { ...position } } : {}) })
        if (!await editor.removeNode(nodeId)) throw new Error(`Could not remove node ${nodeId}.`)
      }
      await applyFunctionResultTransitions(transitionPlan)
      definitions.remove(definitionId)
    } catch {
      for (const [id, type] of previousTypes) if (definitions.get(id)) await applyFunctionResultType(id, type)
      for (const item of removedNodes) {
        if (editor.getNode(item.node.id)) continue
        if (item.scope && definitions.get(item.scope) && !definitions.isProtectedNode(item.node.id)) definitions.assignNode(item.scope, item.node.id)
        await editor.addNode(item.node)
        if (item.position) await area.translate(item.node.id, item.position)
        if (item.pinned && !presentation.isPinned(item.node.id)) presentation.togglePin(item.node.id)
      }
      for (const item of removedConnections) if (!editor.getConnections().some((candidate) => candidate.id === item.id)) await editor.addConnection(item)
      dirtySuspended = previousDirtySuspended
      throw new Error(t('definition.deleteFunctionFailed'))
    }
    dirtySuspended = previousDirtySuspended
    if (!previousDirtySuspended) notifySemanticDirty()
    return true
  }

  return {
    editor,
    area,
    creationContext,
    addNodeAt,
    addModuleCallAt,
    evaluate: (rootNodeId?: string) => evaluateOpenSCAD(editor, engine, rootNodeId, definitions),
    evaluateInspect: (nodeId) => evaluateInspectNode(editor, engine, nodeId, definitions),
    commitGeometryInspect: (nodeId) => inspect.commitGeometry(nodeId),
    commitValueInspect: (nodeId, value) => inspect.commitValue(nodeId, value),
    clearInspect: () => inspect.clear(),
    getInspectedNodeId: () => inspect.id,
    isGeometryNode: (nodeId) => Boolean(editor.getNode(nodeId)?.outputs.geometry),
    getInspectParticipatingNodeIds: () => inspectParticipatingNodeIds(editor, inspect.id),
    removeInputSafely: (nodeId, inputKey) => removeInputSafely(editor, nodeId, inputKey),
    removeOutputSafely: (nodeId, outputKey) => removeOutputSafely(editor, nodeId, outputKey),
    isPinned: (nodeId: string) => presentation.isPinned(nodeId),
    setPinned: (nodeId: string, pinned: boolean) => {
      if (presentation.isPinned(nodeId) === pinned) return
      presentation.togglePin(nodeId)
      notifyDirty()
    },
    createModule,
    renameModule,
    deleteModule,
    focusModule: selectDefinition,
    addModuleParameter,
    editModuleParameter,
    deleteModuleParameter,
    addModuleGeometryInput,
    editModuleGeometryInput,
    deleteModuleGeometryInput,
    addFunctionCallAt,
    createFunction,
    renameFunction,
    deleteFunction,
    focusFunction: selectDefinition,
    addFunctionParameter,
    editFunctionParameter,
    deleteFunctionParameter,
    getDefinitions: () => definitions.list(),
    getNodeScope: (nodeId) => definitions.scopeOf(nodeId),
    clearDefinitions: () => definitions.clear(),
    registerDefinition: (definition) => definitions.add(definition),
    assignNodeToDefinition: (definitionId, nodeId) => definitions.assignNode(definitionId, nodeId),
    onDefinitionsChange: (callback) => definitions.subscribe(callback),
    onDirty: (callback: () => void) => {
      dirtyListeners.add(callback)
      return () => dirtyListeners.delete(callback)
    },
    onSemanticChange: (callback: () => void) => {
      semanticListeners.add(callback)
      return () => semanticListeners.delete(callback)
    },
    onInspect: (callback: (nodeId: string) => void) => {
      inspectListeners.add(callback)
      return () => inspectListeners.delete(callback)
    },
    fitVisibleContent,
    getPersistedViewport: () => ({ ...persistedViewport }),
    setPersistedViewport,
    withDirtyTrackingSuspended: async <T>(fn: () => Promise<T>): Promise<T> => {
      dirtySuspended = true
      try {
        return await fn()
      } finally {
        dirtySuspended = false
      }
    },
    destroy: () => {
      detachMarquee()
      nodeSelection.destroy()
      unsubscribeConnectionSelection()
      container.removeEventListener('pointerdown', clearConnectionOnBlankCanvas, { capture: true })
      window.removeEventListener('pointerdown', selectConnectionOnPointerDown, { capture: true })
      container.removeEventListener('keydown', cancelConnectionOnEscape)
      detachConnectionGestureEvents()
      connectionGesture.reset()
      detachRenderer()
      detachDefinitionFrames()
      unsubscribeDefinitions()
      area.destroy()
    },
  }
}

/**
 * Rete's socket handler stops the original DOM event before it reaches a
 * node root. Capture it at the editor boundary to establish the same
 * explicit gesture state for both connection flows; `connectiondrop`
 * signals above remain the normal completion path. A released click has no
 * movement and intentionally stays active, whereas a drag release clears
 * the temporary presentation state.
 */
function attachConnectionGestureEvents(
  container: HTMLElement,
  gesture: ConnectionGestureManager,
  commitSnap: () => boolean,
  rejectDataflowCycle: (origin: ConnectionGestureOrigin, target: { nodeId: string; key: string; side: 'input' | 'output' }) => boolean,
): () => void {
  let initiatingPointerId: number | null = null
  let movedSincePick = false

  const findSocket = (target: EventTarget | null): HTMLElement | null =>
    target instanceof Element ? target.closest<HTMLElement>('.node-socket') : null
  const isSocketType = (value: string | undefined): value is SocketType =>
    value === 'geometry' || value === 'number' || value === 'vector3' || value === 'boolean'

  const onPointerDown = (event: PointerEvent): void => {
    const socket = findSocket(event.target)
    if (gesture.active) {
      // Let Rete's socket listener receive this second click before clearing
      // our presentation state: clearing synchronously re-renders the
      // candidate and would unmount the very socket Rete is about to use.
      // A blank-canvas click has no socket listener to preserve and cancels
      // immediately. Rete still decides whether a semantic connection is
      // actually created or rejected.
      if (!socket && commitSnap()) {
        event.preventDefault()
        event.stopPropagation()
        return
      }
      if (socket) {
        window.setTimeout(() => {
          // Rete may replace its internal pick object while completing an
          // exact socket click. The second socket click is still terminal
          // for SCADlet's presentation gesture either way.
          gesture.complete()
        })
      } else gesture.cancel()
      return
    }
    if (!socket || !isSocketType(socket.dataset.socketType)) return
    const root = socket.closest<HTMLElement>('.node')
    const socketKey = socket.dataset.socketKey
    const side = socket.dataset.socketSide
    const nodeId = root?.dataset.nodeId
    if (!nodeId || !socketKey || (side !== 'input' && side !== 'output')) return
    gesture.begin({ nodeId, socketKey, side, socketType: socket.dataset.socketType })
    initiatingPointerId = event.pointerId
    movedSincePick = false
  }
  const onPointerMove = (event: PointerEvent): void => {
    if (event.pointerId === initiatingPointerId && event.buttons !== 0) movedSincePick = true
  }
  const onPointerUp = (event: PointerEvent): void => {
    // Some browsers retarget the final pointerup after Rete's drag capture;
    // `movedSincePick` belongs to this one active gesture and is the stable
    // drag-mode discriminator, not the retargeted pointer id.
    if (movedSincePick) {
      // A direct drop can be rejected by Rete before it publishes a
      // `connectioncreate` signal. Resolve the actual socket under the
      // pointer so that this rejected cycle still gets the same actionable
      // feedback as a programmatic connection attempt.
      const root = container.getRootNode()
      const underPointer = root instanceof ShadowRoot
        ? root.elementsFromPoint(event.clientX, event.clientY)
        : document.elementsFromPoint(event.clientX, event.clientY)
      const destinationAtPoint = underPointer
        .map((element) => findSocket(element))
        .find((socket): socket is HTMLElement => socket !== null)
      const destination = findSocket(event.target) ?? destinationAtPoint
      const node = destination?.closest<HTMLElement>('.node')
      const nodeId = node?.dataset.nodeId
      const key = destination?.dataset.socketKey
      const side = destination?.dataset.socketSide
      if (gesture.active && nodeId && key && (side === 'input' || side === 'output') &&
        rejectDataflowCycle(gesture.active.origin, { nodeId, key, side })) {
        gesture.complete()
      } else if (commitSnap()) {
        event.preventDefault()
        event.stopPropagation()
      } else gesture.complete()
    }
    if (event.pointerId === initiatingPointerId || movedSincePick) initiatingPointerId = null
    movedSincePick = false
  }
  const onPointerCancel = (event: PointerEvent): void => {
    if (event.pointerId === initiatingPointerId) {
      initiatingPointerId = null
      gesture.cancel()
    }
  }

  container.addEventListener('pointerdown', onPointerDown, { capture: true })
  container.addEventListener('pointermove', onPointerMove, { capture: true })
  // Window capture runs before Rete's area-level pointerup listener. This
  // preserves the active snap candidate long enough to commit a drag that
  // ended near (rather than directly on) its destination socket.
  window.addEventListener('pointerup', onPointerUp, { capture: true })
  window.addEventListener('pointercancel', onPointerCancel, { capture: true })
  return () => {
    container.removeEventListener('pointerdown', onPointerDown, { capture: true })
    container.removeEventListener('pointermove', onPointerMove, { capture: true })
    window.removeEventListener('pointerup', onPointerUp, { capture: true })
    window.removeEventListener('pointercancel', onPointerCancel, { capture: true })
  }
}

/**
 * Wires up keyboard node deletion on top of the selection state that
 * `AreaExtensions.selectableNodes` already maintains (`node.selected`,
 * toggled by clicking a node or the empty canvas - see `createEditor`).
 * No parallel selection tracking is introduced here.
 */
function attachDeletion(
  editor: NodeEditor<Schemes>,
  area: AreaPlugin<Schemes, AreaExtra>,
  container: HTMLElement,
  connectionSelection: ConnectionSelectionManager,
  canDeleteNode: (nodeId: string) => boolean,
  removeConnection: (connectionId: string) => void,
): void {
  // Not part of the tab order (a big pan/zoom canvas isn't a meaningful
  // tab stop) but focusable programmatically, so a following
  // Delete/Backspace keydown actually reaches the listener below instead
  // of going to whatever was focused before the node was clicked.
  container.tabIndex = -1

  area.addPipe((context) => {
    if (context.type === 'nodepicked') {
      container.focus({ preventScroll: true })
    }
    return context
  })

  container.addEventListener('keydown', (event) => {
    if (event.key !== 'Delete' && event.key !== 'Backspace') return
    if (isEditableTarget(event.target)) return

    const selectedConnection = connectionSelection.id
    if (selectedConnection) {
      event.preventDefault()
      connectionSelection.clear()
      removeConnection(selectedConnection)
      return
    }

    const selected = editor.getNodes().filter((node) => node.selected && canDeleteNode(node.id))
    if (selected.length === 0) return

    event.preventDefault()
    void Promise.all(selected.map((node) => removeNodeWithConnections(editor, node.id, canDeleteNode)))
  })
}

/**
 * Stops a `wheel` event that started inside a node control (input,
 * select, button, contenteditable) from ever reaching Rete's own `wheel`
 * listener on this same container, which zooms the canvas. A
 * capture-phase listener runs before that bubble-phase listener
 * regardless of attachment order, so this is a single, centralized
 * isolation point rather than a `stopPropagation` call added to every
 * individual control (AGENTS.md section 3). Scrolling anywhere else on
 * the canvas (including a node's title/body) still zooms as before.
 */
function isolateControlGestures(container: HTMLElement): void {
  const stopIfEditable = (event: Event): void => {
    if (isEditableTarget(event.target)) event.stopPropagation()
  }
  container.addEventListener('wheel', stopIfEditable, { capture: true })
}

/**
 * `Zoom` (from `rete-area-plugin`) is explicitly designed to be extended
 * for custom behavior; its `dblclick` handler is a `protected` instance
 * field (not a prototype method), so overriding it here in a subclass
 * field replaces the parent's assignment once `super()` runs, before
 * `initialize()` ever attaches the container's `dblclick` listener.
 * Wheel and pinch-to-zoom are untouched - only the double-click zoom
 * gesture is disabled.
 */
class ClicklessZoom extends Zoom {
  protected dblclick = (): void => {}
}

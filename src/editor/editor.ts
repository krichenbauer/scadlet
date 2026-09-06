import { ClassicPreset, NodeEditor } from 'rete'
import { AreaExtensions, AreaPlugin, Zoom } from 'rete-area-plugin'
import { ClassicFlow, ConnectionPlugin, type SocketData } from 'rete-connection-plugin'
import { DataflowEngine } from 'rete-engine'

import { clientToGraphPosition, type Position } from './coordinates'
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
import { ConnectionGestureManager } from './connection-gesture'
import { socketType, type SocketType } from './sockets'
import { guardPortRemoval, hasConnectedInputs, removeInputSafely, removeOutputSafely } from './port-lifecycle'
import { ConnectionSelectionManager } from './connection-selection'
import { canConnectSocketData } from './connection-compatibility'
import { DefinitionRegistry, bindDefinitionRegistry, defaultModuleGeometryInput, moduleGeometryInputPortId, moduleNameProblem, moduleParameterDefaultIsValid, moduleParameterNameProblem, moduleParameterPortId, type FunctionResultType, type ModuleDefinition, type ModuleGeometryInput, type ModuleParameter, type ModuleParameterDefault, type ModuleParameterType } from './definitions'
import { attachDefinitionFrames, definitionFrameBounds, type DefinitionFrameBounds } from './definition-frames'
import { ModuleInputsNode, ModuleOutputNode } from './nodes/module-interface-nodes'
import { ModuleCallNode } from './nodes/module-call-node'
import { FunctionInputsNode, FunctionOutputNode } from './nodes/function-interface-nodes'
import { FunctionCallNode } from './nodes/function-call-node'
import { scopeTransferProblem, type ScopeTransferProblem } from './scope-transfer'
import { t } from '../i18n/translate'

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
  addNodeAt(type: string, clientPosition: Position): Promise<void>
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
  /** Stores the transient OpenSCAD result displayed for an inspected value node. */
  setInspectedValueResult(nodeId: string, value: string): void
  /** Clears the transient value result without affecting graph/project state. */
  clearInspectedValueResult(): void
  /** The node id currently selected as the Inspect Node preview root, or `null` if inspection is inactive. */
  getInspectedNodeId(): string | null
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
  /** Creates a generic Call node for a project Function in Main only. The
   * Function must already have a resolved result type. */
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
export function attachSocketCompatibilityGuard(editor: NodeEditor<Schemes>): void {
  editor.addPipe((context) => {
    if (context.type !== 'connectioncreate') return context
    return canConnectSocketData(editor, {
      nodeId: context.data.source, key: context.data.sourceOutput, side: 'output',
    }, {
      nodeId: context.data.target, key: context.data.targetInput, side: 'input',
    }) ? context : undefined
  })
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
    canMakeConnection: (from, to) => canConnectSocketData(editor, from, to),
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
    if (!from || !to || !canConnectSocketData(editor,
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
  const detachConnectionGestureEvents = attachConnectionGestureEvents(container, connectionGesture, commitSnappedConnection)

  // This is the authoritative live-graph gate. It runs before Rete mutates
  // its connection list, so even callers that construct a
  // `ClassicPreset.Connection` directly cannot insert Geometry→Number,
  // Geometry→Vector3, Geometry→Boolean, or any other implicit conversion.
  attachSocketCompatibilityGuard(editor)

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
    // A displayed inspected value is only valid for the exact graph state
    // OpenSCAD evaluated. Layout and presentation-only dirty events do not
    // reach this path, so hovering, pinning, and canvas movement retain it.
    inspect.clearValueResult()
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
    if (isDirtyAreaSignal(context.type) && !(context.type === 'nodetranslated' && activeScopeDrag)) notifyDirty()
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
      for (const listener of inspectListeners) listener(nodeId)
    },
    () => connectionSelection.clear(),
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
      inspect.remove(context.data.id)
      definitions.forgetNode(context.data.id)
    }
    return context
  })

  // Deliberately does NOT call `AreaExtensions.zoomAt`/pan/zoom after
  // creating a node: the previous per-node-type add functions did, which
  // re-framed the whole viewport around every node (jarring, and doubly
  // pointless once nodes get real positions instead of all stacking at
  // (0, 0)). The current pan/zoom must survive node creation unchanged.
  const creationContext: NodeCreationContext = {
    onControlsChanged: (id) => { void area.update('node', id); notifySemanticDirty() },
    notifyDirty: notifySemanticDirty,
    canRemoveInputs: (nodeId, keys) => !hasConnectedInputs(editor, nodeId, keys),
    getModuleDefinition: (definitionId) => definitions.get(definitionId),
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

  /** Every outgoing connection from any Call of this Function - the exact
   * set that becomes incompatible whenever the Function's result type
   * changes or is cleared. */
  function functionCallOutgoingConnections(definition: ModuleDefinition): Schemes['Connection'][] {
    const callIds = new Set(editor.getNodes().filter((node) => node instanceof FunctionCallNode && node.definitionId === definition.id).map((node) => node.id))
    return editor.getConnections().filter((connection) => callIds.has(connection.source) && connection.sourceOutput === 'value')
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
    const doomed = previousType !== undefined && previousType !== newType ? functionCallOutgoingConnections(definition) : []
    if (doomed.length > 0) {
      let confirmed: boolean
      try {
        confirmed = window.confirm(t('definition.confirmFunctionResultTypeChange').replace('{name}', definition.name).replace('{count}', String(doomed.length)))
      } catch {
        return false
      }
      if (!confirmed) return false
    }
    for (const old of oldResultConnections) await editor.removeConnection(old.id)
    for (const item of doomed) await editor.removeConnection(item.id)
    if (previousType !== newType) await applyFunctionResultType(definitionId!, newType)
    else notifySemanticDirty()
    return true
  }

  /** Routes ordinary connection deletion (Delete/Backspace on a selected
   * wire) through the Function unresolve flow only for the one connection
   * that matters: the sole wire into a Function Output's `result` port.
   * Every other connection deletes exactly as before. */
  async function removeConnectionOrConfirm(connectionId: string): Promise<void> {
    const target = editor.getConnections().find((item) => item.id === connectionId)
    const targetNode = target ? editor.getNode(target.target) : undefined
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
    const doomed = functionCallOutgoingConnections(definition)
    if (doomed.length > 0) {
      let confirmed: boolean
      try {
        confirmed = window.confirm(t('definition.confirmFunctionUnresolve').replace('{name}', definition.name).replace('{count}', String(doomed.length)))
      } catch {
        return
      }
      if (!confirmed) return
    }
    await editor.removeConnection(connectionId)
    for (const item of doomed) await editor.removeConnection(item.id)
    await applyFunctionResultType(definitionId!, undefined)
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
  feedback.className = 'scope-transfer-feedback'
  feedback.hidden = true
  container.appendChild(feedback)
  let feedbackTimer: number | undefined
  const showScopeTransferFeedback = (problem: ScopeTransferProblem): void => {
    feedback.textContent = t(
      problem === 'module-call' ? 'definition.moduleCallsMainOnly'
        : problem === 'function-incompatible' ? 'definition.functionScopeIncompatible'
          : 'definition.invalidScopeTransfer',
    )
    feedback.hidden = false
    if (feedbackTimer !== undefined) window.clearTimeout(feedbackTimer)
    feedbackTimer = window.setTimeout(() => { feedback.hidden = true }, 3500)
  }
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
      const problem = changingScope ? scopeTransferProblem(editor, definitions, drag.nodeIds, targetScope) : null
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

  async function addNodeAt(type: string, clientPosition: Position, scope: string | null | undefined = undefined): Promise<void> {
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

    const node = entry.create(creationContext)
    if (owner !== null) definitions.assignNode(owner, node.id)
    await editor.addNode(node)

    const rect = area.container.getBoundingClientRect()
    const position = clientToGraphPosition(clientPosition, rect, area.area.transform)
    await area.translate(node.id, position)
  }

  async function addModuleCallAt(definitionId: string, clientPosition: Position): Promise<boolean> {
    if (!definitions.get(definitionId) || definitionAt(clientPosition) !== null) return false
    const entry = findCatalogEntry('module-call')!
    const node = entry.create(creationContext, { definitionId })
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
    try {
      connection.drop(); connectionGesture.cancel()
      for (const connection of connections) if (!await editor.removeConnection(connection.id)) throw new Error(`Could not remove connection ${connection.id}.`)
      for (const nodeId of nodeIds) if (!await editor.removeNode(nodeId)) throw new Error(`Could not remove node ${nodeId}.`)
      definitions.remove(definitionId)
    } catch {
      dirtySuspended = previousDirtySuspended
      throw new Error(t('definition.deleteModuleFailed'))
    }
    dirtySuspended = previousDirtySuspended
    if (!previousDirtySuspended) notifySemanticDirty()
    return true
  }

  async function addFunctionCallAt(definitionId: string, clientPosition: Position): Promise<boolean> {
    const definition = definitions.get(definitionId)
    if (!definition || definition.kind !== 'function' || !definition.resultType || definitionAt(clientPosition) !== null) return false
    const entry = findCatalogEntry('function-call')!
    const node = entry.create(creationContext, { definitionId })
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
    const connections = editor.getConnections().filter((connection) => nodeIds.has(connection.source) || nodeIds.has(connection.target))
    const message = t('definition.confirmDeleteFunction')
      .replace('{name}', definition.name)
      .replace('{calls}', String(calls.length))
      .replace('{connections}', String(connections.length))
    try { if (!window.confirm(message)) return false } catch { throw new Error(t('definition.deleteFunctionFailed')) }
    const previousDirtySuspended = dirtySuspended
    dirtySuspended = true
    try {
      connection.drop(); connectionGesture.cancel()
      for (const connection of connections) if (!await editor.removeConnection(connection.id)) throw new Error(`Could not remove connection ${connection.id}.`)
      for (const nodeId of nodeIds) if (!await editor.removeNode(nodeId)) throw new Error(`Could not remove node ${nodeId}.`)
      definitions.remove(definitionId)
    } catch {
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
    setInspectedValueResult: (nodeId, value) => inspect.setValueResult(nodeId, value),
    clearInspectedValueResult: () => inspect.clearValueResult(),
    getInspectedNodeId: () => inspect.id,
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
      if (commitSnap()) {
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

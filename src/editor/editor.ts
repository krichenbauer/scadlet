import { ClassicPreset, NodeEditor } from 'rete'
import { AreaExtensions, AreaPlugin, Zoom } from 'rete-area-plugin'
import { ClassicFlow, ConnectionPlugin, type SocketData } from 'rete-connection-plugin'
import { DataflowEngine } from 'rete-engine'

import { clientToGraphPosition, type Position } from './coordinates'
import { canvasContentBounds, fitCanvasBounds, type CanvasContentItem } from './view-fit'
import { evaluateInspectNode, evaluateOpenSCAD, type InspectEvaluation } from './evaluate'
import { isEditableTarget, removeNodeWithConnections } from './deletion'
import { isDirtyAreaSignal, isDirtyEditorSignal } from './dirty'
import { exceedsCanvasClickTolerance, InspectManager } from './inspect'
import { attachMarqueeSelection } from './marquee'
import { findCatalogEntry, FUNCTION_GRAPH_ALLOWED_NODE_TYPES, identifyNodeType, type NodeCreationContext, type NodeTypeId } from './node-catalog'
import { NodePresentationManager } from './presentation'
import { attachRenderer } from './render'
import type { AreaExtra, Schemes } from './schemes'
import { attachNodeSelection } from './selection'
import { BooleanOpNode } from './nodes/boolean-op-node'
import { canStartConnectionGesture, ConnectionGestureManager, type ConnectionGestureOrigin } from './connection-gesture'
import { hasMainGeometryOutput, socketType } from './sockets'
import { guardPortRemoval, hasConnectedInputs, removeInputSafely, removeOutputSafely } from './port-lifecycle'
import { ConnectionSelectionManager } from './connection-selection'
import { canConnectSocketData, wouldCreateNodeDataflowCycle } from './connection-compatibility'
import { DefinitionRegistry, bindDefinitionRegistry, defaultModuleGeometryInput, moduleGeometryInputPortId, moduleNameProblem, moduleParameterDefaultIsValid, moduleParameterNameProblem, moduleParameterPortId, type FunctionResultType, type ModuleDefinition, type ModuleGeometryInput, type ModuleParameter, type ModuleParameterDefault, type ModuleParameterType } from './definitions'
import { attachDefinitionFrames, definitionFrameBounds, type DefinitionFrameBounds } from './definition-frames'
import { ModuleInputsNode, ModuleOutputNode } from './nodes/module-interface-nodes'
import { ModuleCallNode } from './nodes/module-call-node'
import { FunctionInputsNode, FunctionOutputNode } from './nodes/function-interface-nodes'
import { FunctionCallNode } from './nodes/function-call-node'
import { ConditionalNode, MinMaxNode, TrigonometryNode, VectorMathNode, type TrigonometryOperation, type VectorMathOperation } from './nodes/value-nodes'
import { scopeTransferProblem, type ScopeTransferProblem } from './scope-transfer'
import { t } from '../i18n/translate'
import { registerTransientPopupProvider, TRANSIENT_POPUP_DISMISS_EVENT, type TransientPopupEntry } from '../ui/transient-popups'
import { analyzeFunctionDependencies } from './function-dependencies'
import { bindingNamesInScope, isValueBindingNode, referencesToBinding, reservedBindingNamesInScope, resolveBindingInScope } from './bindings'
import { VariableReferenceNode, type VariableBindingResolution } from './nodes/variable-reference-node'
import { VARIABLE_REFERENCE_DRAG_MIME_TYPE } from './node-catalog'
import { ForHeaderNode, ForResultNode, createDefaultForParams } from './nodes/for-nodes'
import { loopProblemFeedback, loopStructureProblem, type LoopStructureProblem } from './for-validation'
import { liveScopeSnapshot, upstreamNodeIds } from './scope-snapshot'
import { isBoundValueRecord, isValueType, valueNodeType } from './value-types'
import {
  cloneGraphClipboardPayload,
  graphClipboardCommandForKey,
  internalGraphClipboardConnections,
  isNativeClipboardEditingTarget,
  planGraphClipboardPaste,
  type GraphClipboardCommand,
  type GraphClipboardPayload,
  type GraphClipboardPastePlan,
} from './graph-clipboard'

/** The displayed Geometry Inspect source is rooted at one node, so its
 * participating canvas nodes are exactly that root plus its incoming graph
 * dependencies. This is transient presentation data, never graph state. */
function inspectParticipatingNodeIds(editor: NodeEditor<Schemes>, rootNodeId: string | null): Set<string> {
  if (!rootNodeId || !editor.getNode(rootNodeId)) return new Set()
  return upstreamNodeIds(editor.getConnections(), [rootNodeId])
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
  /** Whether evaluation intentionally omitted a structurally valid bodyless
   * For result at or upstream of the requested Geometry root. */
  isBodylessForResultRoot(rootNodeId?: string): boolean
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
  /** Whether `nodeId` is explicitly collapsed (editor presentation state). */
  isCollapsed(nodeId: string): boolean
  /** Applies restored explicit collapse state without touching graph semantics. */
  setCollapsed(nodeId: string, collapsed: boolean): void
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
  /** Creates one compact use of an existing same-scope binding. */
  addVariableReferenceAt(bindingId: string, sourceNodeId: string, clientPosition: Position): Promise<boolean>
  createFunction(name: string): Promise<ModuleDefinition>
  renameFunction(definitionId: string, name: string): Promise<boolean>
  deleteFunction(definitionId: string): Promise<boolean>
  focusFunction(definitionId: string): Promise<void>
  addFunctionParameter(definitionId: string, parameter: { name: string; type: ModuleParameterType; default: ModuleParameterDefault }): Promise<void>
  editFunctionParameter(definitionId: string, parameterId: string, update: { name?: string; type?: ModuleParameterType; default?: ModuleParameterDefault; move?: -1 | 1 }): Promise<boolean>
  deleteFunctionParameter(definitionId: string, parameterId: string): Promise<boolean>
  getDefinitions(): readonly ModuleDefinition[]
  getNodeScope(nodeId: string): string | null
  /** Sets the session-local identity used to keep graph clipboard payloads
   * within the exact project from which they were copied. */
  setClipboardProjectIdentity(projectId: string): void
  /** Cancels only the transient graph placement preview, retaining clipboard. */
  cancelClipboardPlacement(): void
  clearDefinitions(): void
  registerDefinition(definition: ModuleDefinition): void
  assignNodeToDefinition(definitionId: string, nodeId: string): void
  onDefinitionsChange(callback: () => void): () => void
  /**
   * Subscribes to "the project has unsaved changes" notifications:
   * node/connection add/remove, node move, canvas pan/zoom, collapse state,
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
  /** Subscribes to explicit editor interactions that end the active Inspect. */
  onInspectEnd(callback: () => void): () => void
  /** Fits the visible nodes and definition frames without changing persisted viewport state. */
  fitVisibleContent(): Promise<boolean>
  /** The viewport to serialize; transient recovery transforms are deliberately excluded. */
  getPersistedViewport(): { x: number; y: number; k: number }
  /** Applies a restored persistent viewport without treating it as a user edit. */
  setPersistedViewport(viewport: { x: number; y: number; k: number }): Promise<void>
  /**
   * Runs `fn`, suppressing all `onDirty` notifications for its duration -
   * used by `.scadlet` project restore, which necessarily performs
   * operations (adding nodes, moving them, restoring collapse state/viewport)
   * that would otherwise look like user edits and incorrectly leave a
   * freshly loaded project dirty. Node removals during `fn` are treated as
   * provisional restore steps, so they keep the current Inspect provenance.
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

/** Atomically changes Vector Math's typed input/output signature. Compatible
 * wires retain their stable ports; only incompatible connections are
 * confirmation-gated and removed through Rete's lifecycle. */
export async function transitionVectorMathOperation(
  editor: NodeEditor<Schemes>,
  node: VectorMathNode,
  operation: VectorMathOperation,
  confirmRemoval: (connectionCount: number) => boolean,
  updateNode: () => void | Promise<void> = () => {},
): Promise<boolean> {
  const previous = node.getPersistedParams()
  if (previous.operation === operation) return true
  const inputPorts = (op: VectorMathOperation): Set<string> => new Set(['add', 'subtract', 'dot', 'cross'].includes(op)
    ? ['a', 'b'] : ['vector', ...(op === 'scale' ? ['factor'] : op === 'divide' ? ['divisor'] : [])])
  const outputType = (op: VectorMathOperation): 'number' | 'vector3' => ['dot', 'norm'].includes(op) ? 'number' : 'vector3'
  const nextPorts = inputPorts(operation)
  const outputChangesType = outputType(previous.operation) !== outputType(operation)
  const affected = editor.getConnections().filter((edge) =>
    (edge.target === node.id && !nextPorts.has(edge.targetInput))
    || (edge.source === node.id && outputChangesType),
  )
  if (affected.length > 0 && !confirmRemoval(affected.length)) return false
  try {
    for (const edge of affected) await editor.removeConnection(edge.id)
    node.setOperation(operation)
    await updateNode()
    return true
  } catch {
    try {
      node.setOperation(previous.operation)
      for (const edge of affected) if (!editor.getConnections().some((candidate) => candidate.id === edge.id)) await editor.addConnection(edge)
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
  // AreaPlugin sets an inline `overflow: hidden` on its own container
  // (undoing any stylesheet rule, since inline styles always win) to block
  // native touch scrolling. Panning/zooming here is entirely our own CSS
  // transform on the content holder, so the container must never actually
  // become a native scroll target either - otherwise a plain focus() call
  // on any descendant (e.g. restoring focus to a re-rendered Collapse
  // button) triggers the browser's built-in scroll-into-view behavior,
  // silently panning the whole graph via scrollLeft/scrollTop outside any
  // tracked transform state. `clip` (unlike `hidden`) makes scrolling truly
  // inert, including programmatic/focus-driven scroll.
  container.style.overflow = 'clip'
  const connection = new ConnectionPlugin<Schemes, AreaExtra>()
  const connectionGesture = new ConnectionGestureManager()
  const connectionSelection = new ConnectionSelectionManager()
  const definitions = new DefinitionRegistry()
  bindDefinitionRegistry(editor, definitions)
  const engine = new DataflowEngine<Schemes>((node) => ({
    inputs: () => Object.keys(node.inputs),
    outputs: () => Object.keys(node.outputs),
  }))
  let referencePlacement: { bindingId: string; sourceNodeId: string; ghost: HTMLElement } | null = null
  let clipboardProjectId = 'uninitialized-session-project'
  let graphClipboard: GraphClipboardPayload | null = null
  let lastCanvasPointer: Position | null = null
  let clipboardPlacement: {
    payload: GraphClipboardPayload
    preview: HTMLElement
    anchor: Position
    lastClient: Position | null
    kind: 'paste' | 'duplicate'
  } | null = null
  let graphContextMenu: { element: HTMLElement; trigger: HTMLElement; client: Position; nodeContext: boolean } | null = null
  let graphTransactionSuspended = false
  let graphWasLastInteraction = false

  const cancelClipboardPlacement = (): void => {
    clipboardPlacement?.preview.remove()
    clipboardPlacement = null
    container.classList.remove('graph-placement-active')
  }
  const closeGraphContextMenu = (): void => {
    graphContextMenu?.element.remove()
    graphContextMenu = null
  }

  const cancelReferencePlacement = (): void => {
    referencePlacement?.ghost.remove()
    referencePlacement = null
    container.classList.remove('variable-reference-placement-active')
  }

  const beginReferencePlacement = (bindingId: string, sourceNodeId: string): void => {
    cancelReferencePlacement()
    const scope = definitions.scopeOf(sourceNodeId)
    const binding = resolveBindingInScope(editor, definitions, bindingId, scope)
    if (!binding) return
    const ghost = document.createElement('div')
    ghost.className = 'variable-reference-placement-ghost'
    ghost.textContent = binding.name
    ghost.setAttribute('aria-hidden', 'true')
    container.appendChild(ghost)
    referencePlacement = { bindingId, sourceNodeId, ghost }
    container.classList.add('variable-reference-placement-active')
  }
  let showDataflowCycleFeedback: () => void = () => {}
  let showLoopFeedback: (problem: LoopStructureProblem) => void = () => {}
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
  connection.addPreset((socket) => {
    const type = socket.side === 'output'
      ? socketType(editor.getNode(socket.nodeId)?.outputs[socket.key]?.socket)
      : undefined
    return canStartConnectionGesture(socket.side, type)
      ? new ClassicFlow({ canMakeConnection: (from, to) => canCreateConnection(from, to) })
      : undefined
  })

  // Rete emits these signals for both drag and click connection flows. They
  // reconcile temporary disclosure with its actual completion; the capture
  // bridge below establishes a gesture before Rete stops the socket event.
  const syncConnectionGesture = (context: { type: string, data?: unknown }) => {
    if (context.type === 'connectionpick') {
      const { socket } = context.data as { socket: SocketData }
      if (socket.side !== 'output') return
      const node = editor.getNode(socket.nodeId)
      const reteSocket = node?.outputs[socket.key]?.socket
      const type = socketType(reteSocket)
      if (type) connectionGesture.begin({ nodeId: socket.nodeId, socketKey: socket.key, side: 'output', socketType: type })
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
    const source = { nodeId: active.origin.nodeId, key: active.origin.socketKey }
    const target = { nodeId: snap.nodeId, key: snap.socketKey }
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
      void (async () => {
        const input = to.inputs[target.key]
        const replaced = input && !input.multipleConnections
          ? editor.getConnections().filter((item) => item.target === target.nodeId && item.targetInput === target.key)
          : []
        for (const item of replaced) await editor.removeConnection(item.id)
        const created = await editor.addConnection(new ClassicPreset.Connection(from, source.key, to, target.key) as Schemes['Connection'])
        if (!created) {
          for (const item of replaced) await editor.addConnection(item)
          return
        }
        void area.update('node', target.nodeId)
      })()
    })
    return true
  }
  const detachConnectionGestureEvents = attachConnectionGestureEvents(
    container,
    connectionGesture,
    commitSnappedConnection,
    () => { connection.drop(); connectionGesture.cancel() },
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
  editor.addPipe((context) => {
    if (context.type !== 'connectioncreate') return context
    // Paste validates its complete plan up front. Restore adds connections
    // one at a time, so a partly rebuilt scope would look like broken pairs;
    // its whole project was already validated by the same loop rules.
    if (graphTransactionSuspended || restoringProject) return context
    const scope = definitions.scopeOf(context.data.source)
    if (scope !== definitions.scopeOf(context.data.target)) return context
    const { nodes, connections } = liveScopeSnapshot(editor, definitions, scope)
    if (!nodes.some((node) => node.type === 'for' || node.type === 'for-result')) return context
    connections.push({
      id: context.data.id, source: context.data.source, sourceOutput: String(context.data.sourceOutput),
      target: context.data.target, targetInput: String(context.data.targetInput),
    })
    const enclosingNames = new Set<string>([
      ...(scope ? definitions.get(scope)?.parameters?.map((parameter) => parameter.name) ?? [] : []),
      ...nodes.filter(isBoundValueRecord)
        .map((node) => String(node.parameters.name)),
    ])
    const problem = loopStructureProblem(nodes, connections, enclosingNames)
    if (!problem) return context
    showLoopFeedback(problem)
    return undefined
  })
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
  // Restore builds Function Outputs and Conditionals with their validated
  // saved types, so these interactive transition pipes (which may confirm,
  // remove wires, or retype sockets) never run while a project is loading.
  editor.addPipe(async (context) => {
    if (context.type !== 'connectioncreate' || restoringProject) return context
    const target = editor.getNode(context.data.target)
    if (target instanceof FunctionOutputNode && context.data.targetInput === 'result') {
      return (await handleFunctionResultConnectionAttempt(context.data)) ? context : undefined
    }
    return context
  })
  editor.addPipe(async (context) => {
    if (context.type !== 'connectioncreate' || restoringProject) return context
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

  // Presentation state (explicitly collapsed or expanded - see
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
  // concept from collapsed/expanded, not another boolean on the same class.
  const inspect = new InspectManager({
    onChange: (id) => void area.update('node', id),
    onScopeChange: () => { for (const node of editor.getNodes()) void area.update('node', node.id) },
  })
  const inspectEndListeners = new Set<() => void>()
  const endInspect = (): void => {
    if (inspect.id === null) return
    inspect.clear()
    for (const listener of inspectEndListeners) listener()
  }
  let blankCanvasPress: {
    pointerId: number
    start: Position
    moved: boolean
  } | null = null
  area.addPipe((context) => {
    if (context.type === 'pointerdown') {
      const event = context.data.event
      blankCanvasPress = event.pointerType === 'mouse' && event.button !== 0
        ? null
        : {
            pointerId: event.pointerId,
            start: { x: event.clientX, y: event.clientY },
            moved: false,
          }
    } else if (context.type === 'pointermove' && blankCanvasPress?.pointerId === context.data.event.pointerId) {
      blankCanvasPress.moved ||= exceedsCanvasClickTolerance(blankCanvasPress.start, {
        x: context.data.event.clientX,
        y: context.data.event.clientY,
      })
    } else if (context.type === 'pointerup' && blankCanvasPress?.pointerId === context.data.event.pointerId) {
      const wasClick = !blankCanvasPress.moved && !exceedsCanvasClickTolerance(blankCanvasPress.start, {
        x: context.data.event.clientX,
        y: context.data.event.clientY,
      })
      blankCanvasPress = null
      if (wasClick) endInspect()
    }
    return context
  })
  const cancelBlankCanvasPress = (event: PointerEvent): void => {
    if (blankCanvasPress?.pointerId === event.pointerId) blankCanvasPress = null
  }
  window.addEventListener('pointercancel', cancelBlankCanvasPress)
  const unsubscribeConnectionSelection = connectionSelection.subscribe((previous, current) => {
    if (previous) void area.update('connection', previous)
    if (current) void area.update('connection', current)
  })

  // "Unsaved changes" tracking (Milestone 5 persistence). Signal->dirty
  // decisions live in the pure, unit-tested predicates in `dirty.ts`
  // rather than being inlined here, so the exact set of signals that
  // count as a persisted change is easy to review/extend without a real
  // `NodeEditor`/`AreaPlugin`. `dirtySuspended` lets `.scadlet` project
  // restore (`scadlet-app.ts`) perform node/connection/position/collapse/
  // viewport operations that would otherwise look like user edits
  // without leaving the freshly loaded project dirty. Editor transactions
  // also set it to emit one notification per action. It must therefore
  // never mean "a project is being restored"; `restoringProject` does.
  const dirtyListeners = new Set<() => void>()
  const semanticListeners = new Set<() => void>()
  const inspectListeners = new Set<(nodeId: string) => void>()
  let dirtySuspended = false
  let restoringProject = false
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
  const unsubscribeDefinitions = definitions.subscribe(() => {
    cancelReferencePlacement()
    notifySemanticDirty()
  })

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
      void area.update('node', context.data.source)
      void area.update('node', context.data.target)
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
        if (!(node instanceof BooleanOpNode) && !(node instanceof ForResultNode) && !(node instanceof MinMaxNode)) continue
        const connected = new Set(editor.getConnections().filter((item) => item.target === node.id).map((item) => item.targetInput))
        if (node instanceof MinMaxNode ? node.synchronizeOperands(connected) : node.synchronizeChildren(connected)) void area.update('node', node.id)
      }
    }
    return context
  })
  area.addPipe((context) => {
    if ((context.type === 'translated' || context.type === 'zoomed') && !transientViewportChange) {
      persistedViewport = { ...area.area.transform }
    }
    if (context.type === 'translated' || context.type === 'zoomed') {
      if (clipboardPlacement?.lastClient) moveClipboardPlacementToClient(clipboardPlacement.lastClient)
      else updateClipboardPreviewTransform()
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
    if (clipboardPlacement && clipboardPlacement.payload.scope !== definitionId) cancelClipboardPlacement()
    cancelReferencePlacement()
    connectionSelection.clear()
    clearNodeSelection()
    const nodeIds = definitions.nodeIds(definitionId).filter((nodeId) => Boolean(editor.getNode(nodeId)))
    for (const [index, nodeId] of nodeIds.entries()) {
      await nodeSelection.select(nodeId, index > 0)
    }
    container.focus({ preventScroll: true })
  }
  // Shared by keyboard Delete/Backspace (`attachDeletion` below) and the
  // header More menu's Delete action - one predicate, one removal path.
  const canDeleteNode = (nodeId: string): boolean => !definitions.isProtectedNode(nodeId)

  async function renameValueBinding(nodeId: string, rawName: string): Promise<boolean> {
    const node = editor.getNode(nodeId)
    if (!isValueBindingNode(node) && !(node instanceof ForHeaderNode)) return false
    const scope = definitions.scopeOf(nodeId)
    const name = rawName.trim()
    // A Value must also avoid every iterator name in its scope (the saved
    // format's rule); an iterator only checks Values and parameters here and
    // leaves sibling/nested iterator names to `loopStructureProblem` below.
    const takenNames = node instanceof ForHeaderNode
      ? bindingNamesInScope(editor, definitions, scope, node.getBindingId())
      : reservedBindingNamesInScope(editor, definitions, scope, node.getBindingId())
    const problem = moduleParameterNameProblem(name, takenNames)
    if (problem) {
      showFeedback(problem === 'duplicate' ? 'variable.duplicateName' : 'variable.invalidName')
      return false
    }
    if (node instanceof ForHeaderNode) {
      // Check the scope as it would be with the proposed iterator name.
      const proposed = liveScopeSnapshot(editor, definitions, scope, new Map([[node.id, { ...node.getPersistedParams(), name }]]))
      const enclosingNames = new Set(bindingNamesInScope(editor, definitions, scope, node.bindingId))
      const loopProblem = loopStructureProblem(proposed.nodes, proposed.connections, enclosingNames)
      if (loopProblem?.code === 'name') { showFeedback('variable.duplicateName'); return false }
      if (loopProblem?.code === 'shadow') { showLoopFeedback(loopProblem); return false }
    }
    if (node.getBindingId() && node.getBindingName() === name) return true
    node.renameBinding(name)
    const bindingId = node.getBindingId()!
    const binding = resolveBindingInScope(editor, definitions, bindingId, scope)!
    for (const reference of referencesToBinding(editor, definitions, bindingId, scope)) {
      reference.syncBinding(binding)
      await area.update('node', reference.id)
    }
    await area.update('node', node.id)
    return true
  }

  async function removeNodeAndReferences(nodeId: string): Promise<boolean> {
    if (!canDeleteNode(nodeId)) return false
    const node = editor.getNode(nodeId)
    if (!node) return false
    const scope = definitions.scopeOf(nodeId)
    if (node instanceof ForHeaderNode || node instanceof ForResultNode) {
      const pairIds = editor.getNodes()
        .filter((candidate) => (candidate instanceof ForHeaderNode || candidate instanceof ForResultNode) && candidate.pairId === node.pairId)
        .map((candidate) => candidate.id)
      const header = editor.getNodes().find((candidate): candidate is ForHeaderNode => candidate instanceof ForHeaderNode && candidate.pairId === node.pairId)
      if (pairIds.length !== 2 || !header) return false
      const references = referencesToBinding(editor, definitions, header.bindingId, scope)
      const external = editor.getConnections().filter((edge) =>
        (pairIds.includes(edge.source) || pairIds.includes(edge.target)) && !(edge.source === header.id && edge.sourceOutput === 'loop'),
      )
      if (external.length > 0 || references.length > 0) {
        let confirmed = false
        try {
          confirmed = window.confirm(t('for.confirmDeletePair')
            .replace('{connections}', String(external.length))
            .replace('{references}', String(references.length)))
        } catch { confirmed = false }
        if (!confirmed) return false
      }
      const previousDirtySuspended = dirtySuspended
      dirtySuspended = true
      try {
        connection.drop(); connectionGesture.cancel()
        for (const reference of references) await removeNodeWithConnections(editor, reference.id, canDeleteNode)
        for (const id of pairIds) if (editor.getNode(id)) await removeNodeWithConnections(editor, id, canDeleteNode)
      } finally { dirtySuspended = previousDirtySuspended }
      if (!previousDirtySuspended) notifySemanticDirty()
      return true
    }
    const bindingNode = isValueBindingNode(node) ? node : undefined
    const references = bindingNode?.getBindingId()
      ? referencesToBinding(editor, definitions, bindingNode.getBindingId()!, scope)
      : []
    if (references.length > 0) {
      let confirmed = false
      try {
        confirmed = window.confirm(t('variable.confirmDelete')
          .replace('{name}', bindingNode!.getBindingName())
          .replace('{count}', String(references.length)))
      } catch { confirmed = false }
      if (!confirmed) return false
    }
    const previousDirtySuspended = dirtySuspended
    dirtySuspended = true
    try {
      connection.drop(); connectionGesture.cancel()
      for (const reference of references) await removeNodeWithConnections(editor, reference.id, canDeleteNode)
      await removeNodeWithConnections(editor, nodeId, canDeleteNode)
    } finally {
      dirtySuspended = previousDirtySuspended
    }
    if (!previousDirtySuspended) notifySemanticDirty()
    return true
  }

  function expandedClipboardNodeIds(requestedIds: readonly string[]): string[] | null {
    const ids = new Set(requestedIds)
    for (const id of [...ids]) {
      if (definitions.isProtectedNode(id)) {
        showFeedback('clipboard.protectedNode')
        return null
      }
      const node = editor.getNode(id)
      if (!node) return null
      if (!(node instanceof ForHeaderNode) && !(node instanceof ForResultNode)) continue
      const members = editor.getNodes().filter((candidate) =>
        (candidate instanceof ForHeaderNode || candidate instanceof ForResultNode) && candidate.pairId === node.pairId,
      )
      const header = members.find((candidate): candidate is ForHeaderNode => candidate instanceof ForHeaderNode)
      if (members.length !== 2 || !header) {
        showFeedback('for.invalidPair')
        return null
      }
      for (const member of members) ids.add(member.id)
      for (const reference of referencesToBinding(editor, definitions, header.bindingId, definitions.scopeOf(header.id))) ids.add(reference.id)
    }
    return [...ids]
  }

  function buildClipboardPayload(requestedIds: readonly string[]): GraphClipboardPayload | null {
    if (requestedIds.length === 0) return null
    const expandedIds = expandedClipboardNodeIds(requestedIds)
    if (!expandedIds) return null
    const selected = new Set(expandedIds)
    const scopes = new Set(expandedIds.map((id) => definitions.scopeOf(id)))
    if (scopes.size !== 1) {
      showFeedback('clipboard.oneScope')
      return null
    }
    const scope = scopes.values().next().value as string | null
    const nodes = expandedIds.flatMap((id) => {
      const node = editor.getNode(id)
      const type = node ? identifyNodeType(node) : undefined
      const entry = type ? findCatalogEntry(type) : undefined
      const position = area.nodeViews.get(id)?.position
      if (!node || !type || !entry || !position) return []
      const parameters = entry.validateParams(structuredClone(entry.serializeParams(node)))
      if (node instanceof VariableReferenceNode && !resolveBindingInScope(editor, definitions, node.bindingId, scope)) return []
      return [{ id, type, label: node.label, position: { ...position }, parameters, collapsed: presentation.isCollapsed(id) }]
    })
    if (nodes.length !== expandedIds.length) {
      showFeedback('clipboard.invalidSelection')
      return null
    }
    const connections = internalGraphClipboardConnections(editor.getConnections().map((edge) => ({
      id: edge.id,
      source: edge.source,
      sourceOutput: String(edge.sourceOutput),
      target: edge.target,
      targetInput: String(edge.targetInput),
    })), selected)
    return cloneGraphClipboardPayload({ projectId: clipboardProjectId, scope, nodes, connections })
  }

  function validatedClipboardPayload(requestedIds: readonly string[]): GraphClipboardPayload | null {
    try {
      return buildClipboardPayload(requestedIds)
    } catch {
      showFeedback('clipboard.invalidSelection')
      return null
    }
  }

  const selectedNodeIds = (): string[] => editor.getNodes().filter((node) => node.selected).map((node) => node.id)

  function copyNodes(nodeIds: readonly string[]): boolean {
    const payload = validatedClipboardPayload(nodeIds)
    if (!payload) return false
    graphClipboard = payload
    return true
  }

  async function cutNodes(nodeIds: readonly string[]): Promise<boolean> {
    const payload = validatedClipboardPayload(nodeIds)
    if (!payload) return false
    const removalIds = new Set(payload.nodes.map((node) => node.id))
    for (const snapshot of payload.nodes) {
      const node = editor.getNode(snapshot.id)
      if (!isValueBindingNode(node) || !node.getBindingId()) continue
      for (const reference of referencesToBinding(editor, definitions, node.getBindingId()!, payload.scope)) removalIds.add(reference.id)
    }
    const crossingConnections = editor.getConnections().filter((edge) =>
      removalIds.has(edge.source) !== removalIds.has(edge.target),
    )
    const dependentCount = removalIds.size - payload.nodes.length
    if (crossingConnections.length > 0 || dependentCount > 0) {
      let confirmed = false
      try {
        confirmed = window.confirm(t('clipboard.confirmCut')
          .replace('{connections}', String(crossingConnections.length))
          .replace('{references}', String(dependentCount)))
      } catch { confirmed = false }
      if (!confirmed) return false
    }
    const savedNodes = [...removalIds].map((id) => {
      const node = editor.getNode(id)!
      return {
        node,
        scope: definitions.scopeOf(id),
        position: { ...(area.nodeViews.get(id)?.position ?? { x: 0, y: 0 }) },
        collapsed: presentation.isCollapsed(id),
        selected: Boolean(node.selected),
      }
    })
    const savedConnections = editor.getConnections().filter((edge) =>
      removalIds.has(edge.source) || removalIds.has(edge.target),
    )
    const previousDirtySuspended = dirtySuspended
    dirtySuspended = true
    try {
      connection.drop(); connectionGesture.cancel()
      for (const edge of savedConnections) {
        if (editor.getConnections().some((candidate) => candidate.id === edge.id) && !await editor.removeConnection(edge.id)) throw new Error('Could not remove a copied connection.')
      }
      for (const id of removalIds) if (!await editor.removeNode(id)) throw new Error('Could not remove a copied node.')
    } catch {
      try {
        for (const saved of savedNodes) {
          if (editor.getNode(saved.node.id)) continue
          if (saved.scope) definitions.assignNode(saved.scope, saved.node.id)
          await editor.addNode(saved.node)
          await area.translate(saved.node.id, saved.position)
          presentation.setCollapsed(saved.node.id, saved.collapsed)
        }
        for (const edge of savedConnections) if (!editor.getConnections().some((candidate) => candidate.id === edge.id)) await editor.addConnection(edge)
        for (const saved of savedNodes.filter((item) => item.selected)) await nodeSelection.select(saved.node.id, true)
      } finally {
        dirtySuspended = previousDirtySuspended
      }
      showFeedback('clipboard.operationFailed')
      return false
    }
    dirtySuspended = previousDirtySuspended
    graphClipboard = payload
    cancelClipboardPlacement()
    endInspect()
    if (!previousDirtySuspended) notifySemanticDirty()
    return true
  }

  function clipboardBounds(payload: GraphClipboardPayload): { minX: number; minY: number; width: number; height: number } {
    const xs = payload.nodes.map((node) => node.position.x)
    const ys = payload.nodes.map((node) => node.position.y)
    const minX = Math.min(...xs)
    const minY = Math.min(...ys)
    return {
      minX,
      minY,
      width: Math.max(...xs.map((x) => x - minX)) + 160,
      height: Math.max(...ys.map((y) => y - minY)) + 64,
    }
  }

  function renderClipboardPreview(payload: GraphClipboardPayload): HTMLElement {
    const bounds = clipboardBounds(payload)
    const preview = document.createElement('div')
    preview.className = 'graph-placement-preview'
    preview.setAttribute('aria-hidden', 'true')
    preview.style.width = `${bounds.width}px`
    preview.style.height = `${bounds.height}px`
    const byId = new Map(payload.nodes.map((node) => [node.id, node]))
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    svg.classList.add('graph-placement-preview-wires')
    svg.setAttribute('width', String(bounds.width))
    svg.setAttribute('height', String(bounds.height))
    const previewEdges = [...payload.connections]
    const resultByPair = new Map(payload.nodes
      .filter((node) => node.type === 'for-result' && typeof node.parameters.pairId === 'string')
      .map((node) => [String(node.parameters.pairId), node.id]))
    for (const header of payload.nodes.filter((node) => node.type === 'for' && typeof node.parameters.pairId === 'string')) {
      const resultId = resultByPair.get(String(header.parameters.pairId))
      if (resultId) previewEdges.push({ id: `structure:${header.id}`, source: header.id, sourceOutput: 'loop', target: resultId, targetInput: 'loop' })
    }
    for (const edge of previewEdges) {
      const source = byId.get(edge.source)
      const target = byId.get(edge.target)
      if (!source || !target) continue
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
      if (edge.sourceOutput === 'loop') path.classList.add('graph-placement-preview-structural-wire')
      const x1 = source.position.x - bounds.minX + 160
      const y1 = source.position.y - bounds.minY + 31
      const x2 = target.position.x - bounds.minX
      const y2 = target.position.y - bounds.minY + 31
      const bend = Math.max(35, Math.abs(x2 - x1) / 2)
      path.setAttribute('d', `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`)
      svg.appendChild(path)
    }
    preview.appendChild(svg)
    for (const node of payload.nodes) {
      const ghost = document.createElement('div')
      ghost.className = 'graph-placement-preview-node'
      ghost.style.left = `${node.position.x - bounds.minX}px`
      ghost.style.top = `${node.position.y - bounds.minY}px`
      ghost.textContent = node.label
      preview.appendChild(ghost)
    }
    return preview
  }

  const updateClipboardPreviewTransform = (): void => {
    if (!clipboardPlacement) return
    const { x, y, k } = area.area.transform
    clipboardPlacement.preview.style.transform = `translate(${x + clipboardPlacement.anchor.x * k}px, ${y + clipboardPlacement.anchor.y * k}px) scale(${k})`
  }

  const moveClipboardPlacementToClient = (client: Position): void => {
    if (!clipboardPlacement) return
    const rect = area.container.getBoundingClientRect()
    const graph = clientToGraphPosition(client, rect, area.area.transform)
    const bounds = clipboardBounds(clipboardPlacement.payload)
    clipboardPlacement.anchor = { x: graph.x - bounds.width / 2, y: graph.y - bounds.height / 2 }
    clipboardPlacement.lastClient = client
    updateClipboardPreviewTransform()
  }

  function activeClipboardScope(clientPosition?: Position): string | null {
    const selectedScopes = new Set(selectedNodeIds().map((id) => definitions.scopeOf(id)))
    if (selectedScopes.size === 1) return selectedScopes.values().next().value as string | null
    if (clientPosition) return definitionAt(clientPosition)
    return null
  }

  function clipboardCompatibilityProblem(payload: GraphClipboardPayload, scope: string | null): string | null {
    if (payload.projectId !== clipboardProjectId) return 'clipboard.wrongProject'
    if (payload.scope !== scope) return 'clipboard.wrongScope'
    if (payload.nodes.some((node) => node.type === 'scad-settings') && editor.getNodes().some((node) =>
      identifyNodeType(node) === 'scad-settings' && definitions.scopeOf(node.id) === scope,
    )) return 'settings.onePerScope'
    return null
  }

  function beginClipboardPlacement(
    payload: GraphClipboardPayload,
    kind: 'paste' | 'duplicate',
    initialClient?: Position,
    explicitScope?: string | null,
  ): boolean {
    const client = initialClient ?? lastCanvasPointer
    const scope = explicitScope === undefined ? activeClipboardScope(client ?? undefined) : explicitScope
    const problem = clipboardCompatibilityProblem(payload, scope)
    if (problem) {
      showFeedback(problem)
      return false
    }
    cancelReferencePlacement()
    cancelClipboardPlacement()
    const preview = renderClipboardPreview(payload)
    container.appendChild(preview)
    clipboardPlacement = { payload: cloneGraphClipboardPayload(payload), preview, anchor: { x: 0, y: 0 }, lastClient: null, kind }
    container.classList.add('graph-placement-active')
    const rect = area.container.getBoundingClientRect()
    moveClipboardPlacementToClient(client ?? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 })
    container.focus({ preventScroll: true })
    return true
  }

  function plannedBindingResolution(plan: GraphClipboardPastePlan, bindingId: string): VariableBindingResolution | undefined {
    const definition = plan.nodes.find((node) =>
      (node.type === 'for' || isValueType(node.type))
        && node.parameters.bindingId === bindingId,
    )
    if (!definition || typeof definition.parameters.name !== 'string') return undefined
    return {
      id: bindingId,
      name: definition.parameters.name,
      type: definition.type === 'for' ? 'number' : valueNodeType(definition.type)!,
    }
  }

  function preflightClipboardPaste(payload: GraphClipboardPayload, destinationScope: string | null): GraphClipboardPastePlan {
    const problem = clipboardCompatibilityProblem(payload, destinationScope)
    if (problem) throw new Error(t(problem))
    const unavailableNames = new Set(reservedBindingNamesInScope(editor, definitions, payload.scope))
    const plan = planGraphClipboardPaste(payload, unavailableNames)
    if (plan.nodes.some((node) => node.type === 'scad-settings') && editor.getNodes().some((node) =>
      identifyNodeType(node) === 'scad-settings' && definitions.scopeOf(node.id) === payload.scope,
    )) throw new Error(t('settings.onePerScope'))
    for (const node of plan.nodes) {
      const entry = findCatalogEntry(node.type)
      if (!entry) throw new Error(t('clipboard.invalidSelection'))
      entry.validateParams(node.parameters)
      if (node.type === 'variable-reference') {
        const bindingId = String(node.parameters.bindingId ?? '')
        if (!plannedBindingResolution(plan, bindingId) && !resolveBindingInScope(editor, definitions, bindingId, payload.scope)) {
          throw new Error(t('clipboard.staleBinding'))
        }
      }
    }
    const current = liveScopeSnapshot(editor, definitions, payload.scope)
    const plannedNodes = plan.nodes.map((node) => ({ id: node.id, type: node.type, parameters: node.parameters as Record<string, unknown> }))
    const structural = plan.structuralPairs.map((pair) => ({
      id: crypto.randomUUID(), source: pair.headerId, sourceOutput: 'loop', target: pair.resultId, targetInput: 'loop',
    }))
    const loopProblem = loopStructureProblem([...current.nodes, ...plannedNodes], [...current.connections, ...plan.connections, ...structural], new Set(bindingNamesInScope(editor, definitions, payload.scope)))
    if (loopProblem) throw new Error(loopProblemFeedback(loopProblem))
    return plan
  }

  async function commitClipboardPlacement(client: Position): Promise<boolean> {
    const placement = clipboardPlacement
    if (!placement) return false
    let plan: GraphClipboardPastePlan
    try {
      plan = preflightClipboardPaste(placement.payload, definitionAt(client))
    } catch (error) {
      feedback.textContent = error instanceof Error ? error.message : t('clipboard.operationFailed')
      feedback.hidden = false
      return false
    }
    const bounds = clipboardBounds(placement.payload)
    const created = new Map<string, Schemes['Node']>()
    try {
      for (const planned of plan.nodes) {
        const binding = planned.type === 'variable-reference'
          ? plannedBindingResolution(plan, String(planned.parameters.bindingId))
            ?? resolveBindingInScope(editor, definitions, String(planned.parameters.bindingId), placement.payload.scope)
          : undefined
        const node = planned.type === 'variable-reference'
          ? new VariableReferenceNode({ bindingId: String(planned.parameters.bindingId) }, binding!)
          : findCatalogEntry(planned.type)!.create(creationContext, planned.parameters as Record<string, unknown>)
        node.id = planned.id
        created.set(planned.id, node)
      }
    } catch {
      showFeedback('clipboard.operationFailed')
      return false
    }
    const previousDirtySuspended = dirtySuspended
    dirtySuspended = true
    graphTransactionSuspended = true
    const addedIds: string[] = []
    const assignedIds: string[] = []
    try {
      for (const planned of plan.nodes) {
        const node = created.get(planned.id)!
        if (placement.payload.scope) {
          definitions.assignNode(placement.payload.scope, node.id)
          assignedIds.push(node.id)
        }
        if (!await editor.addNode(node)) throw new Error('Could not add pasted node.')
        addedIds.push(node.id)
        await area.translate(node.id, {
          x: placement.anchor.x + planned.position.x - bounds.minX,
          y: placement.anchor.y + planned.position.y - bounds.minY,
        })
        presentation.setCollapsed(node.id, planned.collapsed)
      }
      for (const pair of plan.structuralPairs) {
        const structural = new ClassicPreset.Connection(created.get(pair.headerId)!, 'loop', created.get(pair.resultId)!, 'loop') as Schemes['Connection']
        if (!await editor.addConnection(structural)) throw new Error('Could not add pasted For boundary.')
      }
      for (const planned of plan.connections) {
        const edge = new ClassicPreset.Connection(created.get(planned.source)!, planned.sourceOutput, created.get(planned.target)!, planned.targetInput) as Schemes['Connection']
        edge.id = planned.id
        if (!await editor.addConnection(edge)) throw new Error('Could not add pasted connection.')
      }
    } catch {
      try {
        for (const id of [...addedIds].reverse()) if (editor.getNode(id)) await removeNodeWithConnections(editor, id)
        for (const id of assignedIds) definitions.forgetNode(id)
      } finally {
        graphTransactionSuspended = false
        dirtySuspended = previousDirtySuspended
      }
      showFeedback('clipboard.operationFailed')
      return false
    }
    graphTransactionSuspended = false
    for (const node of editor.getNodes().filter((node) => node.selected)) await nodeSelection.unselect(node.id)
    for (const [index, id] of addedIds.entries()) await nodeSelection.select(id, index > 0)
    dirtySuspended = previousDirtySuspended
    cancelClipboardPlacement()
    endInspect()
    if (!previousDirtySuspended) notifySemanticDirty()
    return true
  }

  function duplicateNodes(nodeIds: readonly string[], initialClient?: Position): boolean {
    const payload = validatedClipboardPayload(nodeIds)
    if (!payload) return false
    return beginClipboardPlacement(payload, 'duplicate', initialClient, payload.scope)
  }

  function handleGraphClipboardCommand(command: GraphClipboardCommand): boolean {
    if (command === 'copy') {
      const ids = selectedNodeIds()
      if (ids.length === 0) return false
      copyNodes(ids)
      return true
    }
    if (command === 'cut') {
      if (selectedNodeIds().length === 0) return false
      void cutNodes(selectedNodeIds())
      return true
    }
    if (command === 'duplicate') {
      const ids = selectedNodeIds()
      if (ids.length === 0) return false
      duplicateNodes(ids)
      return true
    }
    if (!graphClipboard) return false
    beginClipboardPlacement(graphClipboard, 'paste')
    return true
  }

  async function syncBindingReferences(bindingId: string, scope: string | null): Promise<void> {
    const binding = resolveBindingInScope(editor, definitions, bindingId, scope)
    if (!binding) return
    for (const reference of referencesToBinding(editor, definitions, bindingId, scope)) {
      reference.syncBinding(binding)
      await area.update('node', reference.id)
    }
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
        endInspect()
        return
      }
      // Switching Inspect roots ends the previous preview first. The app's
      // resume request is immediately superseded by the new Inspect, whose
      // start cancels that pending debounce.
      if (inspect.id !== null) endInspect()
      inspect.activate(nodeId, inspectParticipatingNodeIds(editor, nodeId))
      for (const listener of inspectListeners) listener(nodeId)
    },
    (nodeId) => {
      connectionSelection.clear()
      if (inspect.id !== null && !inspect.participates(nodeId)) endInspect()
    },
    selectConnection,
    (nodeId) => { void removeNodeAndReferences(nodeId) },
    (nodeId, command) => {
      if (command === 'copy') copyNodes([nodeId])
      else if (command === 'cut') void cutNodes([nodeId])
      else duplicateNodes([nodeId])
    },
    (nodeId, command) => {
      if (definitions.isProtectedNode(nodeId)) return t('clipboard.protectedNode')
      if (command === 'duplicate' && identifyNodeType(editor.getNode(nodeId)!) === 'scad-settings') return t('settings.onePerScope')
      return null
    },
    renameValueBinding,
    beginReferencePlacement,
  )
  const detachDefinitionFrames = attachDefinitionFrames(area, definitions, {
    select: selectDefinition,
    translateSelected: (dx, dy) => nodeSelection.translate(dx, dy),
    scopeTransferState: (definitionId) => scopeDestination?.definitionId === definitionId
      ? scopeDestination.valid ? 'valid' : 'invalid'
      : null,
    scopeTransferFrameBounds: (definitionId) => activeScopeDrag?.sourceFrameBounds.get(definitionId) ?? null,
  })

  const detachTransientPopups = registerTransientPopupProvider(() => {
    const entries: TransientPopupEntry[] = []
    if (graphContextMenu) {
      const menu = graphContextMenu
      entries.push({
      popup: menu.element,
      trigger: menu.trigger,
      dismiss: closeGraphContextMenu,
      restoreFocus: () => {
        if (menu.trigger.isConnected) menu.trigger.focus({ preventScroll: true })
        else container.focus({ preventScroll: true })
      },
      })
    }
    for (const details of container.querySelectorAll<HTMLDetailsElement>('details[open]')) {
      const trigger = details.querySelector<HTMLElement>(':scope > summary')
      if (!trigger) continue
      entries.push({
        popup: details,
        trigger,
        dismiss: () => { details.open = false; trigger.setAttribute('aria-expanded', 'false') },
        restoreFocus: () => { if (trigger.isConnected) trigger.focus({ preventScroll: true }) },
      })
    }
    for (const popup of container.querySelectorAll<HTMLElement>('.node-parameter-popover')) {
      const nodeElement = popup.closest<HTMLElement>('.node')
      const trigger = nodeElement?.querySelector<HTMLElement>('.node-add-summary')
      if (!nodeElement || !trigger) continue
      const nodeId = nodeElement.dataset.nodeId
      entries.push({
        popup,
        trigger,
        dismiss: () => popup.dispatchEvent(new Event(TRANSIENT_POPUP_DISMISS_EVENT)),
        restoreFocus: () => requestAnimationFrame(() => {
          const currentNode = [...container.querySelectorAll<HTMLElement>('.node')]
            .find((candidate) => candidate.dataset.nodeId === nodeId)
          currentNode?.querySelector<HTMLElement>('.node-add-summary')?.focus({ preventScroll: true })
        }),
      })
    }
    return entries
  })

  AreaExtensions.simpleNodesOrder(area)

  attachDeletion(editor, area, container, connectionSelection, canDeleteNode, (connectionId) => void removeConnectionOrConfirm(connectionId), removeNodeAndReferences)
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
      cancelReferencePlacement()
      connectionGesture.removeNode(context.data.id)
      presentation.remove(context.data.id)
      // Restore is transactional: if reconstruction fails it rolls the old
      // graph back. Do not discard its Inspect provenance during those
      // provisional node removals; the application clears it only after a
      // replacement project has committed successfully. Every other removal
      // (including deletions inside editor transactions) is final.
      if (!restoringProject) inspect.remove(context.data.id)
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

  async function requestVectorMathOperationChange(nodeId: string, operation: VectorMathOperation): Promise<boolean> {
    const node = editor.getNode(nodeId)
    if (!(node instanceof VectorMathNode)) return false
    const wasSuspended = dirtySuspended
    dirtySuspended = true
    const changed = await transitionVectorMathOperation(editor, node, operation, (count) => {
      try { return window.confirm(t('math.confirmVectorMathChange').replace('{count}', String(count))) } catch { return false }
    }, () => area.update('node', node.id))
    dirtySuspended = wasSuspended
    if (changed && !wasSuspended) notifySemanticDirty()
    return changed
  }

  /** Confirm-gated (established concise warning flow) removal of a built-in
   * dynamic node's parameter/form: disconnects any wires on `inputKeys`
   * before the node's own `removableRows()` entry mutates its ports and
   * controls (node-style.md "Remove parameter"). */
  async function requestRemoveForm(nodeId: string, inputKeys: readonly string[], label: string): Promise<boolean> {
    const doomed = editor.getConnections().filter((item) => item.target === nodeId && inputKeys.includes(item.targetInput))
    if (doomed.length > 0) {
      let confirmed = false
      try { confirmed = window.confirm(t('control.confirmRemoveForm').replace('{name}', label).replace('{count}', String(doomed.length))) } catch { confirmed = false }
      if (!confirmed) return false
    }
    const previousDirtySuspended = dirtySuspended
    dirtySuspended = true
    try {
      if (doomed.length > 0) {
        connection.drop()
        connectionGesture.cancel()
        for (const item of doomed) await editor.removeConnection(item.id)
      }
    } finally {
      dirtySuspended = previousDirtySuspended
    }
    if (!previousDirtySuspended) notifySemanticDirty()
    return true
  }

  const creationContext: NodeCreationContext = {
    onControlsChanged: (id) => { void area.update('node', id); notifySemanticDirty() },
    notifyDirty: notifySemanticDirty,
    canRemoveInputs: (nodeId, keys) => !hasConnectedInputs(editor, nodeId, keys),
    requestRemoveForm,
    getModuleDefinition: (definitionId) => definitions.get(definitionId),
    requestTrigonometryOperationChange,
    requestVectorMathOperationChange,
  }

  async function addModuleParameter(definitionId: string, input: { name: string; type: ModuleParameterType; default: ModuleParameterDefault }): Promise<void> {
    const definition = definitions.get(definitionId)
    if (!definition) throw new Error(`Unknown Module definition "${definitionId}".`)
    const nameProblem = moduleParameterNameProblem(input.name, reservedBindingNamesInScope(editor, definitions, definitionId))
    if (nameProblem) throw new Error(nameProblem === 'duplicate' ? t('definition.duplicateParameter') : t('definition.invalidParameter'))
    if (!moduleParameterDefaultIsValid(input.type, input.default)) throw new Error(t('definition.invalidParameterDefault'))
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
      || (editor.getNode(connection.source) instanceof VariableReferenceNode
        && (editor.getNode(connection.source) as VariableReferenceNode).bindingId === parameterId
        && definitions.scopeOf(connection.source) === definition.id)
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
    for (const parameter of definition.parameters ?? []) await syncBindingReferences(parameter.id, definition.id)
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
    const nameProblem = moduleParameterNameProblem(next.name, reservedBindingNamesInScope(editor, definitions, definitionId, parameterId))
    if (nameProblem) throw new Error(nameProblem === 'duplicate' ? t('definition.duplicateParameter') : t('definition.invalidParameter'))
    if (!isValueType(next.type) || !moduleParameterDefaultIsValid(next.type, next.default)) throw new Error(t('definition.invalidParameterDefault'))
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
    const references = referencesToBinding(editor, definitions, parameterId, definitionId)
    try {
      if ((doomed.length > 0 || references.length > 0) && !window.confirm((references.length > 0 ? t('variable.confirmDeleteParameter') : t('definition.confirmDeleteParameter'))
        .replace('{name}', parameter.name)
        .replace('{count}', String(doomed.length))
        .replace('{connections}', String(doomed.length))
        .replace('{references}', String(references.length)))) return false
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
      for (const reference of references) {
        if (!await editor.removeNode(reference.id)) throw new Error(`Could not remove reference ${reference.id}.`)
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
    const nameProblem = moduleParameterNameProblem(input.name, reservedBindingNamesInScope(editor, definitions, definitionId))
    if (nameProblem) throw new Error(nameProblem === 'duplicate' ? t('definition.duplicateFunctionParameter') : t('definition.invalidParameter'))
    if (!moduleParameterDefaultIsValid(input.type, input.default)) throw new Error(t('definition.invalidParameterDefault'))
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
      || (editor.getNode(connection.source) instanceof VariableReferenceNode
        && (editor.getNode(connection.source) as VariableReferenceNode).bindingId === parameterId
        && definitions.scopeOf(connection.source) === definition.id)
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
    for (const parameter of definition.parameters ?? []) await syncBindingReferences(parameter.id, definition.id)
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
    const nameProblem = moduleParameterNameProblem(next.name, reservedBindingNamesInScope(editor, definitions, definitionId, parameterId))
    if (nameProblem) throw new Error(nameProblem === 'duplicate' ? t('definition.duplicateFunctionParameter') : t('definition.invalidParameter'))
    if (!isValueType(next.type) || !moduleParameterDefaultIsValid(next.type, next.default)) throw new Error(t('definition.invalidParameterDefault'))
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
    const references = referencesToBinding(editor, definitions, parameterId, definitionId)
    try {
      if ((doomed.length > 0 || references.length > 0) && !window.confirm((references.length > 0 ? t('variable.confirmDeleteParameter') : t('definition.confirmDeleteParameter'))
        .replace('{name}', parameter.name)
        .replace('{count}', String(doomed.length))
        .replace('{connections}', String(doomed.length))
        .replace('{references}', String(references.length)))) return false
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
      for (const reference of references) {
        if (!await editor.removeNode(reference.id)) throw new Error(`Could not remove reference ${reference.id}.`)
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
    if (!isValueType(newType)) return false
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
    if (!isValueType(nextType)) return false
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
  const showFeedback = (key: string): void => showFeedbackText(t(key))
  const showFeedbackText = (text: string): void => {
    feedback.textContent = text
    feedback.hidden = false
    if (feedbackTimer !== undefined) window.clearTimeout(feedbackTimer)
    feedbackTimer = window.setTimeout(() => { feedback.hidden = true }, 3500)
  }
  showScopeTransferFeedback = (problem: ScopeTransferProblem): void => {
    showFeedback(
      problem === 'module-call' ? 'definition.moduleCallsMainOnly'
        : problem === 'function-incompatible' ? 'definition.functionScopeIncompatible'
          : problem === 'settings-duplicate' ? 'settings.onePerScope'
            : problem === 'binding-conflict' ? 'variable.duplicateName'
              : problem === 'variable-reference' ? 'variable.invalidScope'
          : 'definition.invalidScopeTransfer',
    )
  }
  showDataflowCycleFeedback = () => showFeedback('connection.dataflowCycle')
  showLoopFeedback = (problem) => showFeedbackText(loopProblemFeedback(problem))

  const contextMenuButton = (
    label: string,
    run: () => void,
    options: { disabledReason?: string; destructive?: boolean } = {},
  ): HTMLButtonElement => {
    const button = document.createElement('button')
    button.type = 'button'
    button.textContent = label
    button.setAttribute('role', 'menuitem')
    button.disabled = Boolean(options.disabledReason)
    if (options.disabledReason) {
      button.title = options.disabledReason
      button.setAttribute('aria-label', `${label}: ${options.disabledReason}`)
    }
    if (options.destructive) button.classList.add('graph-context-delete')
    button.addEventListener('click', () => {
      if (button.disabled) return
      closeGraphContextMenu()
      run()
    })
    return button
  }

  const openGraphContextMenu = async (
    client: Position,
    nodeId: string | null,
    trigger: HTMLElement,
  ): Promise<void> => {
    closeGraphContextMenu()
    for (const details of container.querySelectorAll<HTMLDetailsElement>('details[open]')) details.open = false
    if (clipboardPlacement) cancelClipboardPlacement()
    if (nodeId) {
      const alreadySelected = Boolean(editor.getNode(nodeId)?.selected)
      const previouslySelected = selectedNodeIds()
      if (!alreadySelected) {
        for (const id of previouslySelected) await nodeSelection.unselect(id)
        await nodeSelection.select(nodeId, false)
      }
      for (const node of editor.getNodes()) node.selected = node.id === nodeId || (alreadySelected && previouslySelected.includes(node.id))
      for (const id of new Set([...previouslySelected, nodeId])) await area.update('node', id)
      connectionSelection.clear()
    }
    const scope = nodeId ? definitions.scopeOf(nodeId) : definitionAt(client)
    const menu = document.createElement('div')
    menu.className = 'graph-context-menu'
    menu.setAttribute('role', 'menu')
    menu.setAttribute('aria-label', t('clipboard.contextMenu'))
    menu.style.left = `${Math.min(client.x, window.innerWidth - 170)}px`
    menu.style.top = `${Math.min(client.y, window.innerHeight - 220)}px`
    const effectiveSelection = nodeId ? selectedNodeIds() : []
    const selectionProblem = effectiveSelection.some((id) => definitions.isProtectedNode(id))
      ? t('clipboard.protectedNode')
      : new Set(effectiveSelection.map((id) => definitions.scopeOf(id))).size > 1
        ? t('clipboard.oneScope')
        : undefined
    if (nodeId) {
      menu.append(
        contextMenuButton(t('menu.copy'), () => { copyNodes(effectiveSelection) }, { disabledReason: selectionProblem }),
        contextMenuButton(t('menu.cut'), () => { void cutNodes(effectiveSelection) }, { disabledReason: selectionProblem }),
      )
    }
    const pasteProblem = graphClipboard
      ? clipboardCompatibilityProblem(graphClipboard, scope)
      : 'clipboard.empty'
    menu.append(contextMenuButton(t('menu.paste'), () => {
      if (graphClipboard) beginClipboardPlacement(graphClipboard, 'paste', client, scope)
    }, { disabledReason: pasteProblem ? t(pasteProblem) : undefined }))
    if (nodeId) {
      const selected = effectiveSelection
      const containsSettings = selected.some((id) => identifyNodeType(editor.getNode(id)!) === 'scad-settings')
      menu.append(
        contextMenuButton(t('menu.duplicate'), () => { duplicateNodes(selected, client) }, {
          disabledReason: selectionProblem ?? (containsSettings ? t('settings.onePerScope') : undefined),
        }),
        contextMenuButton(t('menu.delete'), () => {
          void (async () => {
            for (const id of selected) if (editor.getNode(id)) await removeNodeAndReferences(id)
          })()
        }, { destructive: true, disabledReason: selectionProblem }),
      )
    }
    container.appendChild(menu)
    graphContextMenu = { element: menu, trigger, client, nodeContext: Boolean(nodeId) }
    requestAnimationFrame(() => menu.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus({ preventScroll: true }))
  }

  const nodeIdFromEvent = (event: Event): string | null => event.composedPath().find(
    (item): item is HTMLElement => item instanceof HTMLElement && item.classList.contains('node'),
  )?.dataset.nodeId ?? null

  const onGraphContextMenu = (event: MouseEvent): void => {
    if (!container.contains(event.target as Node)) return
    if (performance.now() < suppressLongPressUntil) {
      event.preventDefault()
      event.stopImmediatePropagation()
      return
    }
    event.preventDefault()
    event.stopPropagation()
    const nodeId = nodeIdFromEvent(event)
    void openGraphContextMenu({ x: event.clientX, y: event.clientY }, nodeId, container)
  }
  const isolateSecondaryGraphPress = (event: PointerEvent): void => {
    if (event.button !== 2) return
    event.preventDefault()
    event.stopImmediatePropagation()
  }

  const onGraphClipboardKeydown = (event: KeyboardEvent): void => {
    const root = container.getRootNode()
    const active = root instanceof ShadowRoot ? root.activeElement : document.activeElement
    const path = event.composedPath()
    const graphFocused = path.includes(container) || active === container || (active instanceof Node && container.contains(active))
    if (!graphFocused && !graphWasLastInteraction) return
    if (path.some((target) => isNativeClipboardEditingTarget(target))) return
    if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
      const eventNodeId = nodeIdFromEvent(event)
      const selected = selectedNodeIds()
      const nodeId = eventNodeId ?? (selected.length > 0 ? selected[0]! : null)
      const nodeRect = nodeId ? area.nodeViews.get(nodeId)?.element.getBoundingClientRect() : undefined
      const rect = container.getBoundingClientRect()
      const client = nodeRect
        ? { x: nodeRect.left + nodeRect.width / 2, y: nodeRect.top + Math.min(32, nodeRect.height / 2) }
        : lastCanvasPointer ?? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
      event.preventDefault()
      event.stopPropagation()
      void openGraphContextMenu(client, nodeId, nodeId ? area.nodeViews.get(nodeId)?.element ?? container : container)
      return
    }
    const apple = /Mac|iPhone|iPad|iPod/u.test(navigator.platform)
    const command = graphClipboardCommandForKey(event, apple)
    if (!command || !handleGraphClipboardCommand(command)) return
    graphWasLastInteraction = true
    event.preventDefault()
    event.stopPropagation()
  }

  const onClipboardPointerMove = (event: PointerEvent): void => {
    const rect = container.getBoundingClientRect()
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) return
    lastCanvasPointer = { x: event.clientX, y: event.clientY }
    if (clipboardPlacement) moveClipboardPlacementToClient(lastCanvasPointer)
  }
  const trackGraphInteractionContext = (event: Event): void => {
    graphWasLastInteraction = event.composedPath().includes(container)
  }
  const onClipboardPlacementPointerDown = (event: PointerEvent): void => {
    if (!clipboardPlacement || event.button !== 0) return
    const blocked = event.composedPath().some((item) => item instanceof Element && item.matches(
      '.node, .connection, button, input, select, textarea, [contenteditable="true"], .graph-context-menu',
    ))
    if (blocked) return
    event.preventDefault()
    event.stopImmediatePropagation()
    void commitClipboardPlacement({ x: event.clientX, y: event.clientY })
  }
  const onClipboardPlacementEscape = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape' || !clipboardPlacement) return
    event.preventDefault()
    event.stopImmediatePropagation()
    cancelClipboardPlacement()
  }

  let longPress: { pointerId: number; start: Position; client: Position; nodeId: string | null; trigger: HTMLElement; timer: number; opened: boolean } | null = null
  let suppressLongPressUntil = 0
  const clearLongPress = (): void => {
    if (longPress) window.clearTimeout(longPress.timer)
    longPress = null
  }
  const onLongPressPointerDown = (event: PointerEvent): void => {
    if ((event.pointerType !== 'touch' && event.pointerType !== 'pen') || event.button !== 0) return
    if (event.composedPath().some((item) => item instanceof Element && item.matches('button, input, select, textarea, .node-socket, .connection'))) return
    const nodeId = nodeIdFromEvent(event)
    const trigger = container
    const state = {
      pointerId: event.pointerId,
      start: { x: event.clientX, y: event.clientY },
      client: { x: event.clientX, y: event.clientY },
      nodeId,
      trigger,
      timer: 0,
      opened: false,
    }
    state.timer = window.setTimeout(() => {
      if (longPress !== state) return
      state.opened = true
      suppressLongPressUntil = performance.now() + 800
      void openGraphContextMenu(state.client, state.nodeId, state.trigger)
    }, 550)
    longPress = state
  }
  const onLongPressPointerMove = (event: PointerEvent): void => {
    if (!longPress || event.pointerId !== longPress.pointerId) return
    const dx = event.clientX - longPress.start.x
    const dy = event.clientY - longPress.start.y
    if (dx * dx + dy * dy > 64) clearLongPress()
  }
  const onLongPressPointerEnd = (event: PointerEvent): void => {
    if (!longPress || event.pointerId !== longPress.pointerId) return
    const opened = longPress.opened
    clearLongPress()
    if (opened) {
      event.preventDefault()
      event.stopImmediatePropagation()
    }
  }
  const suppressSyntheticLongPressEvent = (event: Event): void => {
    if (performance.now() >= suppressLongPressUntil) return
    event.preventDefault()
    event.stopImmediatePropagation()
  }

  container.addEventListener('contextmenu', onGraphContextMenu)
  container.addEventListener('pointerdown', isolateSecondaryGraphPress, { capture: true })
  container.addEventListener('keydown', onGraphClipboardKeydown)
  window.addEventListener('keydown', onGraphClipboardKeydown)
  window.addEventListener('pointermove', onClipboardPointerMove, { capture: true })
  container.addEventListener('pointerdown', onClipboardPlacementPointerDown, { capture: true })
  window.addEventListener('keydown', onClipboardPlacementEscape, { capture: true })
  container.addEventListener('pointerdown', onLongPressPointerDown, { capture: true })
  window.addEventListener('pointermove', onLongPressPointerMove, { capture: true })
  window.addEventListener('pointerup', onLongPressPointerEnd, { capture: true })
  window.addEventListener('pointercancel', onLongPressPointerEnd, { capture: true })
  container.addEventListener('click', suppressSyntheticLongPressEvent, { capture: true })
  document.addEventListener('pointerdown', trackGraphInteractionContext, { capture: true })
  document.addEventListener('focusin', trackGraphInteractionContext, { capture: true })

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
      if (clipboardPlacement && clipboardPlacement.payload.scope !== definitions.scopeOf(context.data.id)) cancelClipboardPlacement()
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
    if (type === 'scad-settings' && editor.getNodes().some((node) =>
      identifyNodeType(node) === 'scad-settings' && definitions.scopeOf(node.id) === owner,
    )) {
      showFeedback('settings.onePerScope')
      return
    }

    if (type === 'for') {
      const pair = createDefaultForParams()
      const headerEntry = findCatalogEntry('for')!
      const resultEntry = findCatalogEntry('for-result')!
      const header = headerEntry.create(creationContext, pair.header as unknown as Record<string, unknown>) as ForHeaderNode
      const result = resultEntry.create(creationContext, pair.result as unknown as Record<string, unknown>) as ForResultNode
      const previousDirtySuspended = dirtySuspended
      dirtySuspended = true
      try {
        if (owner !== null) {
          definitions.assignNode(owner, header.id)
          definitions.assignNode(owner, result.id)
        }
        if (!await editor.addNode(header) || !await editor.addNode(result)) throw new Error('Could not create For pair.')
        const structural = new ClassicPreset.Connection(header, 'loop', result, 'loop') as Schemes['Connection']
        if (!await editor.addConnection(structural)) throw new Error('Could not create fixed For boundary.')
        const rect = area.container.getBoundingClientRect()
        const position = clientToGraphPosition(clientPosition, rect, area.area.transform)
        await area.translate(header.id, position)
        await area.translate(result.id, { x: position.x + 360, y: position.y })
      } catch {
        if (editor.getNode(header.id)) await removeNodeWithConnections(editor, header.id)
        if (editor.getNode(result.id)) await removeNodeWithConnections(editor, result.id)
        dirtySuspended = previousDirtySuspended
        showFeedback('for.invalidPair')
        return
      }
      dirtySuspended = previousDirtySuspended
      endInspect()
      if (!previousDirtySuspended) notifySemanticDirty()
      return
    }

    let validatedParams: Record<string, unknown> | undefined
    try { validatedParams = params === undefined ? undefined : entry.validateParams(params) } catch { return }
    const node = entry.create(creationContext, validatedParams)
    if (owner !== null) definitions.assignNode(owner, node.id)
    if (!await editor.addNode(node)) return
    // Palette creation replaces the inspected subtree context. Clear only
    // after Rete accepted the new node, so malformed or rejected drops leave
    // the active Inspect result untouched.
    endInspect()

    const rect = area.container.getBoundingClientRect()
    const position = clientToGraphPosition(clientPosition, rect, area.area.transform)
    await area.translate(node.id, position)
  }

  async function addVariableReferenceAt(bindingId: string, sourceNodeId: string, clientPosition: Position): Promise<boolean> {
    const owner = definitionAt(clientPosition)
    const sourceScope = definitions.scopeOf(sourceNodeId)
    if (!editor.getNode(sourceNodeId) || owner !== sourceScope) {
      showFeedback('variable.invalidScope')
      return false
    }
    const binding = resolveBindingInScope(editor, definitions, bindingId, owner)
    if (!binding) {
      showFeedback('variable.invalidScope')
      return false
    }
    cancelReferencePlacement()
    const node = new VariableReferenceNode({ bindingId }, binding)
    if (owner !== null) definitions.assignNode(owner, node.id)
    if (!await editor.addNode(node)) return false
    endInspect()
    const rect = area.container.getBoundingClientRect()
    await area.translate(node.id, clientToGraphPosition(clientPosition, rect, area.area.transform))
    return true
  }

  const moveReferencePlacementGhost = (event: PointerEvent): void => {
    if (!referencePlacement) return
    referencePlacement.ghost.style.left = `${event.clientX + 12}px`
    referencePlacement.ghost.style.top = `${event.clientY + 12}px`
  }
  const placeReferenceOnCanvas = (event: PointerEvent): void => {
    if (!referencePlacement || event.button !== 0) return
    if (event.target instanceof Element && event.target.closest('.node, .connection, .definition-frame, button, input, select, textarea')) {
      cancelReferencePlacement()
      return
    }
    const { bindingId, sourceNodeId } = referencePlacement
    event.preventDefault()
    event.stopImmediatePropagation()
    cancelReferencePlacement()
    void addVariableReferenceAt(bindingId, sourceNodeId, { x: event.clientX, y: event.clientY })
  }
  const cancelReferencePlacementOnEscape = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape' || !referencePlacement) return
    event.preventDefault()
    event.stopImmediatePropagation()
    cancelReferencePlacement()
  }
  const allowReferenceDrop = (event: DragEvent): void => {
    if (!event.dataTransfer?.types.includes(VARIABLE_REFERENCE_DRAG_MIME_TYPE)) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
  }
  const createReferenceFromDrop = (event: DragEvent): void => {
    const raw = event.dataTransfer?.getData(VARIABLE_REFERENCE_DRAG_MIME_TYPE)
    if (!raw) return
    let payload: { bindingId: string; sourceNodeId: string }
    try {
      const parsed = JSON.parse(raw) as Partial<typeof payload>
      if (typeof parsed.bindingId !== 'string' || typeof parsed.sourceNodeId !== 'string') return
      payload = { bindingId: parsed.bindingId, sourceNodeId: parsed.sourceNodeId }
    } catch { return }
    event.preventDefault()
    event.stopImmediatePropagation()
    cancelReferencePlacement()
    void addVariableReferenceAt(payload.bindingId, payload.sourceNodeId, { x: event.clientX, y: event.clientY })
  }
  window.addEventListener('pointermove', moveReferencePlacementGhost, { capture: true })
  container.addEventListener('pointerdown', placeReferenceOnCanvas, { capture: true })
  window.addEventListener('keydown', cancelReferencePlacementOnEscape, { capture: true })
  container.addEventListener('dragover', allowReferenceDrop)
  container.addEventListener('drop', createReferenceFromDrop)

  async function addModuleCallAt(definitionId: string, clientPosition: Position): Promise<boolean> {
    const owner = definitionAt(clientPosition)
    if (!definitions.get(definitionId) || (owner !== null && definitions.get(owner)?.kind === 'function')) return false
    const entry = findCatalogEntry('module-call')!
    const node = entry.create(creationContext, { definitionId })
    if (owner !== null) definitions.assignNode(owner, node.id)
    if (!await editor.addNode(node)) return false
    endInspect()
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
    const removedNodes: { node: Schemes['Node']; scope: string | null; collapsed: boolean; position?: Position }[] = []
    try {
      connection.drop(); connectionGesture.cancel()
      for (const item of connections) {
        if (!await editor.removeConnection(item.id)) throw new Error(`Could not remove connection ${item.id}.`)
        removedConnections.push(item)
      }
      for (const nodeId of nodeIds) {
        const node = editor.getNode(nodeId)!
        const position = area.nodeViews.get(nodeId)?.position
        removedNodes.push({ node, scope: definitions.scopeOf(nodeId), collapsed: presentation.isCollapsed(nodeId), ...(position ? { position: { ...position } } : {}) })
        if (!await editor.removeNode(nodeId)) throw new Error(`Could not remove node ${nodeId}.`)
      }
      definitions.remove(definitionId)
    } catch {
      for (const item of removedNodes) {
        if (editor.getNode(item.node.id)) continue
        if (item.scope && definitions.get(item.scope) && !definitions.isProtectedNode(item.node.id)) definitions.assignNode(item.scope, item.node.id)
        await editor.addNode(item.node)
        if (item.position) await area.translate(item.node.id, item.position)
        if (item.collapsed) presentation.setCollapsed(item.node.id, true)
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
    if (!await editor.addNode(node)) return false
    endInspect()
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
    const removedNodes: { node: Schemes['Node']; scope: string | null; collapsed: boolean; position?: Position }[] = []
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
        removedNodes.push({ node, scope: definitions.scopeOf(nodeId), collapsed: presentation.isCollapsed(nodeId), ...(position ? { position: { ...position } } : {}) })
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
        if (item.collapsed) presentation.setCollapsed(item.node.id, true)
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
    isBodylessForResultRoot: (rootNodeId?: string) => {
      const bodyless = (node: Schemes['Node']): boolean => node instanceof ForResultNode
        && !editor.getConnections().some((edge) => edge.target === node.id && String(edge.targetInput).startsWith('child:'))
      const dependsOnBodylessResult = (rootIds: readonly string[]): boolean =>
        [...upstreamNodeIds(editor.getConnections(), rootIds)].some((id) => {
          const node = editor.getNode(id)
          return Boolean(node && bodyless(node))
        })
      if (rootNodeId !== undefined) return dependsOnBodylessResult([rootNodeId])
      const mainIds = new Set(editor.getNodes()
        .filter((node) => definitions.scopeOf(node.id) === null)
        .map((node) => node.id))
      const consumed = new Set(editor.getConnections()
        .filter((edge) => mainIds.has(edge.source) && mainIds.has(edge.target))
        .map((edge) => edge.source))
      const roots = editor.getNodes()
        .filter((node) => mainIds.has(node.id) && !consumed.has(node.id) && hasMainGeometryOutput(node.outputs))
        .map((node) => node.id)
      return dependsOnBodylessResult(roots)
    },
    evaluateInspect: (nodeId) => evaluateInspectNode(editor, engine, nodeId, definitions),
    commitGeometryInspect: (nodeId) => inspect.commitGeometry(nodeId),
    commitValueInspect: (nodeId, value) => inspect.commitValue(nodeId, value),
    clearInspect: () => inspect.clear(),
    getInspectedNodeId: () => inspect.id,
    isGeometryNode: (nodeId) => { const node = editor.getNode(nodeId); return Boolean(node && hasMainGeometryOutput(node.outputs)) },
    getInspectParticipatingNodeIds: () => inspectParticipatingNodeIds(editor, inspect.id),
    removeInputSafely: (nodeId, inputKey) => removeInputSafely(editor, nodeId, inputKey),
    removeOutputSafely: (nodeId, outputKey) => removeOutputSafely(editor, nodeId, outputKey),
    isCollapsed: (nodeId: string) => presentation.isCollapsed(nodeId),
    setCollapsed: (nodeId: string, collapsed: boolean) => {
      if (presentation.isCollapsed(nodeId) === collapsed) return
      presentation.setCollapsed(nodeId, collapsed)
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
    addVariableReferenceAt,
    createFunction,
    renameFunction,
    deleteFunction,
    focusFunction: selectDefinition,
    addFunctionParameter,
    editFunctionParameter,
    deleteFunctionParameter,
    getDefinitions: () => definitions.list(),
    getNodeScope: (nodeId) => definitions.scopeOf(nodeId),
    setClipboardProjectIdentity: (projectId) => {
      if (projectId !== clipboardProjectId) cancelClipboardPlacement()
      clipboardProjectId = projectId
    },
    cancelClipboardPlacement,
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
    onInspectEnd: (callback: () => void) => {
      inspectEndListeners.add(callback)
      return () => inspectEndListeners.delete(callback)
    },
    fitVisibleContent,
    getPersistedViewport: () => ({ ...persistedViewport }),
    setPersistedViewport,
    withDirtyTrackingSuspended: async <T>(fn: () => Promise<T>): Promise<T> => {
      const previousDirtySuspended = dirtySuspended
      const previousRestoringProject = restoringProject
      dirtySuspended = true
      restoringProject = true
      try {
        return await fn()
      } finally {
        dirtySuspended = previousDirtySuspended
        restoringProject = previousRestoringProject
      }
    },
    destroy: () => {
      cancelReferencePlacement()
      cancelClipboardPlacement()
      closeGraphContextMenu()
      window.removeEventListener('pointermove', moveReferencePlacementGhost, { capture: true })
      container.removeEventListener('pointerdown', placeReferenceOnCanvas, { capture: true })
      window.removeEventListener('keydown', cancelReferencePlacementOnEscape, { capture: true })
      container.removeEventListener('dragover', allowReferenceDrop)
      container.removeEventListener('drop', createReferenceFromDrop)
      container.removeEventListener('contextmenu', onGraphContextMenu)
      container.removeEventListener('pointerdown', isolateSecondaryGraphPress, { capture: true })
      container.removeEventListener('keydown', onGraphClipboardKeydown)
      window.removeEventListener('keydown', onGraphClipboardKeydown)
      window.removeEventListener('pointermove', onClipboardPointerMove, { capture: true })
      container.removeEventListener('pointerdown', onClipboardPlacementPointerDown, { capture: true })
      window.removeEventListener('keydown', onClipboardPlacementEscape, { capture: true })
      container.removeEventListener('pointerdown', onLongPressPointerDown, { capture: true })
      window.removeEventListener('pointermove', onLongPressPointerMove, { capture: true })
      window.removeEventListener('pointerup', onLongPressPointerEnd, { capture: true })
      window.removeEventListener('pointercancel', onLongPressPointerEnd, { capture: true })
      container.removeEventListener('click', suppressSyntheticLongPressEvent, { capture: true })
      document.removeEventListener('pointerdown', trackGraphInteractionContext, { capture: true })
      document.removeEventListener('focusin', trackGraphInteractionContext, { capture: true })
      clearLongPress()
      detachTransientPopups()
      detachMarquee()
      nodeSelection.destroy()
      window.removeEventListener('pointercancel', cancelBlankCanvasPress)
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
  resetConnection: () => void,
  rejectDataflowCycle: (origin: ConnectionGestureOrigin, target: { nodeId: string; key: string; side: 'input' | 'output' }) => boolean,
): () => void {
  let initiatingPointerId: number | null = null
  let movedSincePick = false

  const findSocket = (target: EventTarget | null): HTMLElement | null =>
    target instanceof Element ? target.closest<HTMLElement>('.node-socket') : null

  const onPointerDown = (event: PointerEvent): void => {
    const socket = findSocket(event.target)
    if (gesture.active) {
      // The explicit expand button is part of the held click-wire workflow:
      // let its own handlers re-render the target without dropping, replacing,
      // or restarting Rete's current connection pick.
      if (event.target instanceof Element && event.target.closest('.node-collapse')) return
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
          // for SCADlet's presentation gesture either way. Dropping here is
          // also the keyboard path's pointerup equivalent when compatibility
          // rejected the target and Rete kept its pseudo-flow active.
          resetConnection()
        })
      } else gesture.cancel()
      return
    }
    if (!socket || socket.dataset.socketSide !== 'output' || !canStartConnectionGesture('output', socket.dataset.socketType)) return
    const root = socket.closest<HTMLElement>('.node')
    const socketKey = socket.dataset.socketKey
    const nodeId = root?.dataset.nodeId
    if (!nodeId || !socketKey) return
    gesture.begin({ nodeId, socketKey, side: 'output', socketType: socket.dataset.socketType })
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

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== 'Enter' && event.key !== ' ') return
    const socket = findSocket(event.target)
    if (!socket) return
    const side = socket.dataset.socketSide
    const socketType = socket.dataset.socketType
    if (side === 'input' && !gesture.active) {
      event.preventDefault()
      return
    }
    if (side !== 'input' && side !== 'output') return
    if (side === 'output' && !canStartConnectionGesture(side, socketType)) return
    if (side === 'output' && gesture.active) resetConnection()
    const rect = socket.getBoundingClientRect()
    const init = {
      bubbles: true,
      composed: true,
      cancelable: true,
      clientX: rect.left + rect.width / 2,
      clientY: rect.top + rect.height / 2,
      pointerId: -1,
      pointerType: 'keyboard',
      button: 0,
      buttons: 1,
    }
    event.preventDefault()
    socket.dispatchEvent(new PointerEvent('pointerdown', init))
  }

  container.addEventListener('pointerdown', onPointerDown, { capture: true })
  container.addEventListener('pointermove', onPointerMove, { capture: true })
  // Window capture runs before Rete's area-level pointerup listener. This
  // preserves the active snap candidate long enough to commit a drag that
  // ended near (rather than directly on) its destination socket.
  window.addEventListener('pointerup', onPointerUp, { capture: true })
  window.addEventListener('pointercancel', onPointerCancel, { capture: true })
  container.addEventListener('keydown', onKeyDown)
  return () => {
    container.removeEventListener('pointerdown', onPointerDown, { capture: true })
    container.removeEventListener('pointermove', onPointerMove, { capture: true })
    window.removeEventListener('pointerup', onPointerUp, { capture: true })
    window.removeEventListener('pointercancel', onPointerCancel, { capture: true })
    container.removeEventListener('keydown', onKeyDown)
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
  removeNode: (nodeId: string) => Promise<boolean>,
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
    void (async () => {
      for (const node of selected) if (editor.getNode(node.id)) await removeNode(node.id)
    })()
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

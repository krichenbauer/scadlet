import { NodeEditor } from 'rete'
import { AreaExtensions, AreaPlugin, Zoom } from 'rete-area-plugin'
import { ClassicFlow, ConnectionPlugin, type SocketData } from 'rete-connection-plugin'
import { DataflowEngine } from 'rete-engine'

import { clientToGraphPosition, type Position } from './coordinates'
import { evaluateOpenSCAD } from './evaluate'
import { isEditableTarget, removeNodeWithConnections } from './deletion'
import { isDirtyAreaSignal, isDirtyEditorSignal } from './dirty'
import { InspectManager } from './inspect'
import { attachMarqueeSelection } from './marquee'
import { findCatalogEntry, type NodeCreationContext } from './node-catalog'
import { NodePresentationManager } from './presentation'
import { attachRenderer } from './render'
import type { AreaExtra, Schemes } from './schemes'
import { attachNodeSelection } from './selection'
import { BooleanOpNode } from './nodes/boolean-op-node'
import { areSocketTypesCompatible } from './sockets'

export interface SCADletEditor {
  editor: NodeEditor<Schemes>
  area: AreaPlugin<Schemes, AreaExtra>
  /** The node-creation context passed to catalog `create()` calls - reused by `.scadlet` project restore (`persistence/restore.ts`) so restored nodes get the same progressive-disclosure wiring as normally-created ones. */
  creationContext: NodeCreationContext
  /**
   * Creates a node of the given catalog type and places it so that
   * `clientPosition` (viewport coordinates, e.g. `event.clientX/Y`)
   * becomes its top-left origin in graph space. The single creation path
   * used by both palette drag/drop and the click fallback (`addNodeAtCenter`).
   */
  addNodeAt(type: string, clientPosition: Position): Promise<void>
  /** Creates a node of the given catalog type near the visible center of the canvas, without changing pan/zoom. */
  addNodeAtCenter(type: string): Promise<void>
  /**
   * Evaluates the graph into OpenSCAD source. With no argument this is
   * the normal full-model evaluation (unchanged). Passing `rootNodeId`
   * evaluates only that node's upstream subtree instead - the Inspect
   * Node feature's preview source - without mutating the graph or
   * affecting the normal (no-argument) evaluation in any way.
   */
  evaluate(rootNodeId?: string): Promise<string>
  /** The node id currently selected as the Inspect Node preview root, or `null` if inspection is inactive. */
  getInspectedNodeId(): string | null
  /** Whether `nodeId` is currently explicitly pinned open (editor presentation state - see `presentation.ts`). */
  isPinned(nodeId: string): boolean
  /** Sets a node's pinned state directly (used by `.scadlet` project restore) rather than toggling. */
  setPinned(nodeId: string, pinned: boolean): void
  /**
   * Subscribes to "the project has unsaved changes" notifications:
   * node/connection add/remove, node move, canvas pan/zoom, pin state,
   * and persisted-parameter control edits (see `dirty.ts` and
   * `node-catalog.ts`'s `wireDirtyNotifications`) - project-name edits
   * are tracked separately in `scadlet-app.ts`. Returns an unsubscribe
   * function.
   */
  onDirty(callback: () => void): () => void
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

function canConnectSocketData(
  editor: NodeEditor<Schemes>,
  first: SocketData,
  second: SocketData,
): boolean {
  const sourceData = first.side === 'output' ? first : second.side === 'output' ? second : undefined
  const targetData = first.side === 'input' ? first : second.side === 'input' ? second : undefined
  if (!sourceData || !targetData) return false
  const sourceSocket = editor.getNode(sourceData.nodeId)?.outputs[sourceData.key]?.socket
  const targetSocket = editor.getNode(targetData.nodeId)?.inputs[targetData.key]?.socket
  return areSocketTypesCompatible(sourceSocket, targetSocket)
}

/** Installs the same semantic connection gate used by the browser editor.
 * Exported for DOM-free regression tests and for any future editor host that
 * intentionally reuses SCADlet's graph semantics. */
export function attachSocketCompatibilityGuard(editor: NodeEditor<Schemes>): void {
  editor.addPipe((context) => {
    if (context.type !== 'connectioncreate') return context
    const source = editor.getNode(context.data.source)
    const target = editor.getNode(context.data.target)
    const sourceSocket = source?.outputs[context.data.sourceOutput]?.socket
    const targetSocket = target?.inputs[context.data.targetInput]?.socket
    return areSocketTypesCompatible(sourceSocket, targetSocket) ? context : undefined
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

  // Rete's classic preset intentionally treats socket names as display
  // metadata. SCADlet has a closed semantic socket vocabulary, so enforce
  // its diagonal-only compatibility here for drag/click creation as well as
  // the editor `connectioncreate` guard below for programmatic creation.
  connection.addPreset(() => new ClassicFlow({
    canMakeConnection: (from, to) => canConnectSocketData(editor, from, to),
  }))

  editor.use(area)
  editor.use(engine)
  area.use(connection)

  // This is the authoritative live-graph gate. It runs before Rete mutates
  // its connection list, so even callers that construct a
  // `ClassicPreset.Connection` directly cannot insert Geometry→Number,
  // Geometry→Vector3, Geometry→Boolean, or any other implicit conversion.
  attachSocketCompatibilityGuard(editor)

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

  // "Unsaved changes" tracking (Milestone 5 persistence). Signal->dirty
  // decisions live in the pure, unit-tested predicates in `dirty.ts`
  // rather than being inlined here, so the exact set of signals that
  // count as a persisted change is easy to review/extend without a real
  // `NodeEditor`/`AreaPlugin`. `dirtySuspended` lets `.scadlet` project
  // restore (`scadlet-app.ts`) perform node/connection/position/pin/
  // viewport operations that would otherwise look like user edits
  // without leaving the freshly loaded project dirty.
  const dirtyListeners = new Set<() => void>()
  let dirtySuspended = false
  function notifyDirty(): void {
    if (dirtySuspended) return
    for (const listener of dirtyListeners) listener()
  }

  editor.addPipe((context) => {
    if (isDirtyEditorSignal(context.type)) notifyDirty()
    return context
  })

  // Variadic Boolean child slots grow only when their trailing extension
  // port becomes connected. This runs against Rete's authoritative
  // connection list and never reindexes an existing slot/connection.
  editor.addPipe((context) => {
    if (context.type === 'connectioncreated' || context.type === 'connectionremoved') {
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
    if (isDirtyAreaSignal(context.type)) notifyDirty()
    return context
  })

  attachRenderer(area, connection, presentation, inspect, notifyDirty)

  AreaExtensions.simpleNodesOrder(area)

  attachDeletion(editor, area, container)

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

  // Clears presentation timers/state whenever a node is removed, so no
  // stale timer can ever fire and try to update a node that no longer
  // exists (AGENTS.md section 3/15).
  editor.addPipe((context) => {
    if (context.type === 'noderemoved') {
      presentation.remove(context.data.id)
      inspect.remove(context.data.id)
    }
    return context
  })

  // Deliberately does NOT call `AreaExtensions.zoomAt`/pan/zoom after
  // creating a node: the previous per-node-type add functions did, which
  // re-framed the whole viewport around every node (jarring, and doubly
  // pointless once nodes get real positions instead of all stacking at
  // (0, 0)). The current pan/zoom must survive node creation unchanged.
  const creationContext: NodeCreationContext = {
    onControlsChanged: (id) => { void area.update('node', id); notifyDirty() },
    notifyDirty,
    canSwitchRepresentation: (nodeId) => !editor.getConnections().some((connection) =>
      connection.target === nodeId && editor.getNode(nodeId)?.inputs[connection.targetInput]?.socket.name !== 'geometry',
    ),
  }

  async function addNodeAt(type: string, clientPosition: Position): Promise<void> {
    const entry = findCatalogEntry(type)
    if (!entry) return

    const node = entry.create(creationContext)
    await editor.addNode(node)

    const rect = area.container.getBoundingClientRect()
    const position = clientToGraphPosition(clientPosition, rect, area.area.transform)
    await area.translate(node.id, position)
  }

  async function addNodeAtCenter(type: string): Promise<void> {
    const rect = area.container.getBoundingClientRect()
    await addNodeAt(type, { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 })
  }

  return {
    editor,
    area,
    creationContext,
    addNodeAt,
    addNodeAtCenter,
    evaluate: (rootNodeId?: string) => evaluateOpenSCAD(editor, engine, rootNodeId),
    getInspectedNodeId: () => inspect.id,
    isPinned: (nodeId: string) => presentation.isPinned(nodeId),
    setPinned: (nodeId: string, pinned: boolean) => {
      if (presentation.isPinned(nodeId) === pinned) return
      presentation.togglePin(nodeId)
      notifyDirty()
    },
    onDirty: (callback: () => void) => {
      dirtyListeners.add(callback)
      return () => dirtyListeners.delete(callback)
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
      area.destroy()
    },
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

    const selected = editor.getNodes().filter((node) => node.selected)
    if (selected.length === 0) return

    event.preventDefault()
    void Promise.all(selected.map((node) => removeNodeWithConnections(editor, node.id)))
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

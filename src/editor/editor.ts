import { NodeEditor } from 'rete'
import { AreaExtensions, AreaPlugin } from 'rete-area-plugin'
import { ConnectionPlugin, Presets as ConnectionPresets } from 'rete-connection-plugin'
import { DataflowEngine } from 'rete-engine'

import { clientToGraphPosition, type Position } from './coordinates'
import { evaluateOpenSCAD } from './evaluate'
import { isEditableTarget, removeNodeWithConnections } from './deletion'
import { InspectManager } from './inspect'
import { attachMarqueeSelection } from './marquee'
import { findCatalogEntry } from './node-catalog'
import { NodePresentationManager } from './presentation'
import { attachRenderer } from './render'
import type { AreaExtra, Schemes } from './schemes'
import { attachNodeSelection } from './selection'

export interface SCADletEditor {
  editor: NodeEditor<Schemes>
  area: AreaPlugin<Schemes, AreaExtra>
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
  destroy(): void
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

  connection.addPreset(ConnectionPresets.classic.setup())

  editor.use(area)
  editor.use(engine)
  area.use(connection)

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
  attachRenderer(area, connection, presentation, inspect)

  AreaExtensions.simpleNodesOrder(area)

  attachDeletion(editor, area, container)

  // Shift+drag rectangle selection on empty canvas (AGENTS.md-adjacent
  // task: multi-selection). Selects through the same `nodeSelection` API
  // click-based selection uses, so marquee-selected nodes participate in
  // group movement/deletion identically.
  const detachMarquee = attachMarqueeSelection(editor, area, container, nodeSelection)

  // Rete's zoom extension listens for `wheel`/`dblclick` directly on this
  // same `container` element that node controls render inside, so without
  // isolation, e.g. double-clicking a number input to select its value
  // also bubbles up and zooms the whole canvas (AGENTS.md section 3).
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
  async function addNodeAt(type: string, clientPosition: Position): Promise<void> {
    const entry = findCatalogEntry(type)
    if (!entry) return

    const node = entry.create({ onControlsChanged: (id) => void area.update('node', id) })
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
    addNodeAt,
    addNodeAtCenter,
    evaluate: (rootNodeId?: string) => evaluateOpenSCAD(editor, engine, rootNodeId),
    getInspectedNodeId: () => inspect.id,
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
 * Stops a `dblclick`/`wheel` event that started inside a node control
 * (input, select, button, contenteditable) from ever reaching Rete's own
 * `dblclick`/`wheel` listeners on this same container, which zoom the
 * canvas. A capture-phase listener runs before those bubble-phase
 * listeners regardless of attachment order, so this is a single,
 * centralized isolation point rather than a `stopPropagation` call added
 * to every individual control (AGENTS.md section 3). Double-clicking or
 * scrolling anywhere else on the canvas (including a node's title/body)
 * still zooms as before.
 */
function isolateControlGestures(container: HTMLElement): void {
  const stopIfEditable = (event: Event): void => {
    if (isEditableTarget(event.target)) event.stopPropagation()
  }
  container.addEventListener('dblclick', stopIfEditable, { capture: true })
  container.addEventListener('wheel', stopIfEditable, { capture: true })
}

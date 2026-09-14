import type { NodeEditor } from 'rete'
import { AreaExtensions } from 'rete-area-plugin'
import type { AreaPlugin } from 'rete-area-plugin'

import type { AreaExtra, Schemes } from './schemes'

export interface NodeSelectionApi {
  /** Selects a node. `accumulate` defaults to `false` (a plain click - replaces the current selection). */
  select(nodeId: string, accumulate?: boolean): Promise<void>
  /** Removes a single node from the current selection, leaving the rest of it untouched. */
  unselect(nodeId: string): Promise<void>
  /** Translates the currently selected Rete entities through the same
   * machinery used when the user drags one selected node. */
  translate(dx: number, dy: number): Promise<void>
  destroy(): void
}

/**
 * Decides the effective "accumulate" flag passed into Rete's own
 * `Selector.add()` for a freshly-picked node. Rete's stock wiring
 * (accumulate = Ctrl/Cmd held) does not support Shift and would otherwise
 * wipe an existing multi-selection down to just the picked node whenever it is picked
 * *without* the modifier - including when that node is already part of
 * the current selection, which would destroy a multi-selection the
 * instant a group-drag gesture starts. Forcing accumulate=true whenever
 * the picked node is already selected keeps the rest of the selection
 * intact regardless of the modifier key, while a plain click on a node
 * that ISN'T already selected still replaces the selection as usual.
 */
export function shouldAccumulateOnPick(selectionModifierHeld: boolean, alreadySelected: boolean): boolean {
  return selectionModifierHeld || alreadySelected
}

/**
 * Decides whether a modifier-click on an already-selected node should toggle
 * it back OFF. Toggle-off is deferred until pointerup so a drag beginning on
 * a selected member preserves and moves the complete selection rather than
 * flickering that member out of the group on pointerdown.
 */
export function shouldToggleOffAfterPick(
  selectionModifierHeld: boolean,
  wasAlreadySelected: boolean,
  moved: boolean,
): boolean {
  return selectionModifierHeld && wasAlreadySelected && !moved
}

/**
 * Wires up Rete's own node-selection extension
 * (`AreaExtensions.selectableNodes`/`Selector`/`accumulateOnCtrl`) as the
 * single source of truth for which nodes are selected - there is no
 * parallel SCADlet-owned selected-node collection, and `node.selected`
 * remains the one flag the renderer and deletion logic already read.
 *
 * The stock extension only supports "replace" (plain click) and
 * "additive" (Ctrl/Cmd-click) selection out of the box. SCADlet derives
 * Shift/Ctrl/Cmd from the initiating pointer event and layers two small
 * behaviors on top of it here, both driven by the pure decisions above:
 *
 *  - a plain click/drag-start on an already-selected node no longer
 *    wipes the rest of a multi-selection, so dragging one member of a
 *    multi-selection moves the whole group instead of collapsing it to
 *    just that node;
 *  - a genuine Shift/Ctrl/Cmd-click on an already-selected node toggles it
 *    back off instead of being a no-op. That removal waits for pointerup and
 *    only happens when the gesture did not become a drag.
 *
 * Also cleans up the shared `Selector`'s bookkeeping when a node is
 * removed from the graph - Rete's own extension only listens for
 * `nodepicked`/`nodetranslated`/pointer signals, not `noderemoved` -
 * which matters once multiple nodes can be selected and deleted
 * together in one action (see `deletion.ts`).
 */
export function attachNodeSelection(
  editor: NodeEditor<Schemes>,
  area: AreaPlugin<Schemes, AreaExtra>,
): NodeSelectionApi {
  const selector = AreaExtensions.selector()

  interface PickGesture {
    nodeId: string
    pointerId: number
    startX: number
    startY: number
    modifierHeld: boolean
    moved: boolean
    picked: boolean
    wasSelected: boolean
  }

  let gesture: PickGesture | null = null
  const nodeFromPointerEvent = (event: PointerEvent): HTMLElement | undefined => event.composedPath().find(
    (item): item is HTMLElement => item instanceof HTMLElement && item.classList.contains('node'),
  )
  const onPointerDown = (event: PointerEvent): void => {
    if (event.pointerType === 'mouse' && event.button !== 0) return
    const nodeId = nodeFromPointerEvent(event)?.dataset.nodeId
    if (!nodeId) return
    gesture = {
      nodeId,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      modifierHeld: event.shiftKey || event.ctrlKey || event.metaKey,
      moved: false,
      picked: false,
      wasSelected: false,
    }
  }
  const onPointerMove = (event: PointerEvent): void => {
    if (!gesture || event.pointerId !== gesture.pointerId || gesture.moved) return
    const dx = event.clientX - gesture.startX
    const dy = event.clientY - gesture.startY
    // Ignore sub-pixel pointer noise from an ordinary click while still
    // settling the selection before Rete applies any meaningful movement.
    gesture.moved = dx * dx + dy * dy >= 9
  }
  const finishGesture = (event: PointerEvent, cancelled: boolean): void => {
    if (!gesture || event.pointerId !== gesture.pointerId) return
    const finished = gesture
    gesture = null
    if (!cancelled && finished.picked && shouldToggleOffAfterPick(
      finished.modifierHeld,
      finished.wasSelected,
      finished.moved,
    )) {
      void nodeSelection.unselect(finished.nodeId)
    }
  }
  const onPointerUp = (event: PointerEvent): void => finishGesture(event, false)
  const onPointerCancel = (event: PointerEvent): void => finishGesture(event, true)

  // Capture runs before Rete's node-root pointerdown handler stops
  // propagation and emits `nodepicked`, giving the selection pipe the exact
  // modifiers for this pointer session rather than global key state that can
  // become stale when the window loses focus.
  area.container.addEventListener('pointerdown', onPointerDown, { capture: true })
  window.addEventListener('pointermove', onPointerMove, { capture: true })
  window.addEventListener('pointerup', onPointerUp, { capture: true })
  window.addEventListener('pointercancel', onPointerCancel, { capture: true })

  // Captured by the "before" pipe below for whichever single 'nodepicked'
  // event is currently being handled, then read by the wrapped `accumulating`
  // passed into `selectableNodes` while that same event is processed.
  let modifierHeldForPick = false
  let wasSelectedForPick = false

  area.addPipe((context) => {
    if (context.type === 'nodepicked') {
      modifierHeldForPick = gesture?.nodeId === context.data.id ? gesture.modifierHeld : false
      wasSelectedForPick = selector.isSelected({ id: context.data.id, label: 'node' })
      if (gesture?.nodeId === context.data.id) {
        gesture.picked = true
        gesture.wasSelected = wasSelectedForPick
      }
    }
    return context
  })

  const nodeSelection = AreaExtensions.selectableNodes(area, selector, {
    accumulating: {
      active: () => shouldAccumulateOnPick(modifierHeldForPick, wasSelectedForPick),
    },
  })

  editor.addPipe((context) => {
    if (context.type === 'noderemoved') {
      void selector.remove({ id: context.data.id, label: 'node' })
    }
    return context
  })

  return {
    select: (nodeId, accumulate = false) => nodeSelection.select(nodeId, accumulate),
    unselect: (nodeId) => nodeSelection.unselect(nodeId),
    translate: (dx, dy) => selector.translate(dx, dy),
    destroy: () => {
      area.container.removeEventListener('pointerdown', onPointerDown, { capture: true })
      window.removeEventListener('pointermove', onPointerMove, { capture: true })
      window.removeEventListener('pointerup', onPointerUp, { capture: true })
      window.removeEventListener('pointercancel', onPointerCancel, { capture: true })
    },
  }
}

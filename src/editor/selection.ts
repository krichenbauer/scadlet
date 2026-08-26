import type { NodeEditor } from 'rete'
import { AreaExtensions } from 'rete-area-plugin'
import type { AreaPlugin } from 'rete-area-plugin'

import type { AreaExtra, Schemes } from './schemes'

export interface NodeSelectionApi {
  /** Selects a node. `accumulate` defaults to `false` (a plain click - replaces the current selection). */
  select(nodeId: string, accumulate?: boolean): Promise<void>
  /** Removes a single node from the current selection, leaving the rest of it untouched. */
  unselect(nodeId: string): Promise<void>
  destroy(): void
}

/**
 * Decides the effective "accumulate" flag passed into Rete's own
 * `Selector.add()` for a freshly-picked node. Rete's stock wiring
 * (accumulate = Ctrl/Cmd held) would otherwise wipe an existing
 * multi-selection down to just the picked node whenever it's picked
 * *without* the modifier - including when that node is already part of
 * the current selection, which would destroy a multi-selection the
 * instant a group-drag gesture starts. Forcing accumulate=true whenever
 * the picked node is already selected keeps the rest of the selection
 * intact regardless of the modifier key, while a plain click on a node
 * that ISN'T already selected still replaces the selection as usual.
 */
export function shouldAccumulateOnPick(ctrlOrCmdHeld: boolean, alreadySelected: boolean): boolean {
  return ctrlOrCmdHeld || alreadySelected
}

/**
 * Decides whether a Ctrl/Cmd-click on an already-selected node should
 * toggle it back OFF (deselect just that node, leaving the rest of the
 * selection untouched). Rete's own `Selector.add()` has no toggle
 * concept - re-adding an already-selected entity with accumulate=true is
 * simply a no-op - so this is applied as a follow-up step after Rete's
 * own selection bookkeeping has already run for the pick.
 */
export function shouldToggleOffOnPick(ctrlOrCmdHeld: boolean, wasAlreadySelected: boolean): boolean {
  return ctrlOrCmdHeld && wasAlreadySelected
}

/**
 * Wires up Rete's own node-selection extension
 * (`AreaExtensions.selectableNodes`/`Selector`/`accumulateOnCtrl`) as the
 * single source of truth for which nodes are selected - there is no
 * parallel SCADlet-owned selected-node collection, and `node.selected`
 * remains the one flag the renderer and deletion logic already read.
 *
 * The stock extension only supports "replace" (plain click) and
 * "additive" (Ctrl/Cmd-click) selection out of the box. Two small
 * behaviors are layered on top of it here, both driven by the pure
 * decisions above:
 *
 *  - a plain click/drag-start on an already-selected node no longer
 *    wipes the rest of a multi-selection, so dragging one member of a
 *    multi-selection moves the whole group instead of collapsing it to
 *    just that node;
 *  - a genuine Ctrl/Cmd-click on an already-selected node toggles it
 *    back off instead of being a no-op.
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
  const realAccumulating = AreaExtensions.accumulateOnCtrl()

  // Captured by the "before" pipe below for whichever single 'nodepicked'
  // event is currently being handled, then read both by the wrapped
  // `accumulating` passed into `selectableNodes` (still being evaluated
  // while that same event is processed) and by the "after" pipe.
  let ctrlHeldForPick = false
  let wasSelectedForPick = false

  area.addPipe((context) => {
    if (context.type === 'nodepicked') {
      ctrlHeldForPick = realAccumulating.active()
      wasSelectedForPick = selector.isSelected({ id: context.data.id, label: 'node' })
    }
    return context
  })

  const nodeSelection = AreaExtensions.selectableNodes(area, selector, {
    accumulating: {
      active: () => shouldAccumulateOnPick(ctrlHeldForPick, wasSelectedForPick),
    },
  })

  // Runs after `selectableNodes`'s own pipe (registered afterwards, so it
  // observes the selection state that pipe already produced): undoes the
  // reselection for a genuine toggle-off, since `add()` with
  // accumulate=true just re-adds an already-selected entity as a no-op.
  area.addPipe((context) => {
    if (context.type === 'nodepicked' && shouldToggleOffOnPick(ctrlHeldForPick, wasSelectedForPick)) {
      void nodeSelection.unselect(context.data.id)
    }
    return context
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
    destroy: () => realAccumulating.destroy(),
  }
}

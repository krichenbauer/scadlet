import type { NodeEditor } from 'rete'

import type { Schemes } from './schemes'

/**
 * Removes a node together with every connection attached to it (as
 * either source or target), keeping Rete's graph as the single source of
 * truth. The custom DOM renderer (`render.ts`) reacts to the resulting
 * `noderemoved`/`connectionremoved` signals; it never needs to be told
 * directly.
 */
export async function removeNodeWithConnections(
  editor: NodeEditor<Schemes>,
  nodeId: string,
): Promise<void> {
  const attached = editor
    .getConnections()
    .filter((connection) => connection.source === nodeId || connection.target === nodeId)

  for (const connection of attached) {
    await editor.removeConnection(connection.id)
  }

  await editor.removeNode(nodeId)
}

/**
 * True for `<input>`/`<textarea>`/`<select>`/`<button>`/contenteditable
 * targets - i.e. anything a node control renders as (see `render.ts`'s
 * `renderControl` and pin button). Delete/Backspace keep working as
 * ordinary editing there instead of also deleting the selected node, and
 * `editor.ts`'s canvas-gesture isolation (double-click/wheel vs. zoom)
 * reuses this exact same check.
 */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    target instanceof HTMLButtonElement
  ) {
    return true
  }
  return target.isContentEditable
}

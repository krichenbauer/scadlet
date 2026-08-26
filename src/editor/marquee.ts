import type { NodeEditor } from 'rete'
import { Drag } from 'rete-area-plugin'
import type { AreaPlugin } from 'rete-area-plugin'

import type { Position } from './coordinates'
import { isEditableTarget } from './deletion'
import type { NodeSelectionApi } from './selection'
import type { AreaExtra, Schemes } from './schemes'

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/**
 * Normalizes two arbitrary drag corner points - in any direction
 * (top-left to bottom-right, the reverse, or either horizontal flip) -
 * into a rectangle with a fixed top-left origin and non-negative size.
 */
export function normalizeRect(a: Position, b: Position): Rect {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(a.x - b.x),
    height: Math.abs(a.y - b.y),
  }
}

/**
 * A straightforward AABB "intersects" test (overlap, not containment) - a
 * node counts as marquee-selected as soon as its rendered rectangle
 * overlaps the marquee rectangle at all, matching the task's "full
 * containment is not required" rule. Agnostic to which coordinate space
 * the two rectangles share, as long as it's the same one for both -
 * here, both are always measured in client/viewport space.
 */
export function rectsIntersect(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y
}

/**
 * A node's own root element (and everything inside it, including
 * sockets) already stops pointerdown propagation before it ever reaches
 * the container - see `NodeView`'s own `Drag` handler in
 * `rete-area-plugin`, and the socket pointerdown handler in
 * `rete-connection-plugin` - so this check is defense-in-depth for those
 * rather than the primary guard. Connections have no such built-in
 * propagation guard, so this is what actually keeps a marquee from
 * starting when a pointer comes down directly on a rendered connection
 * line.
 */
function isMarqueeBlockedTarget(target: EventTarget | null): boolean {
  if (isEditableTarget(target)) return true
  if (!(target instanceof Element)) return false
  return Boolean(target.closest('.node, .connection'))
}

function clientRectOf(element: HTMLElement): Rect {
  const box = element.getBoundingClientRect()
  return { x: box.left, y: box.top, width: box.width, height: box.height }
}

/**
 * Wires up Shift+drag rectangle ("marquee") selection on empty canvas, on
 * top of the same `NodeSelectionApi`/Rete selection state click-based
 * selection uses (`selection.ts`) - there is no separate, SCADlet-owned
 * selected-node collection, and marquee-selected nodes participate in
 * group movement exactly the same way click/Ctrl-click-selected nodes do.
 *
 * The marquee rectangle and every node's hit-test rectangle are both
 * measured in client/viewport space (`getBoundingClientRect()`), so no
 * pan/zoom transform math needs to be duplicated here - it's already
 * "baked in" to those live browser-computed rectangles.
 *
 * A plain (non-Shift) drag on empty canvas must keep panning exactly as
 * before: `area.area`'s pan `Drag` handler is swapped for one with an
 * extra `!event.shiftKey` guard (otherwise identical to Rete's own
 * default guard), so the two gestures can never both engage for the same
 * pointer session.
 */
export function attachMarqueeSelection(
  editor: NodeEditor<Schemes>,
  area: AreaPlugin<Schemes, AreaExtra>,
  container: HTMLElement,
  nodeSelection: NodeSelectionApi,
): () => void {
  area.area.setDragHandler(
    new Drag({
      down: (event) => !(event.pointerType === 'mouse' && event.button !== 0) && !event.shiftKey,
      move: () => true,
    }),
  )

  const overlay = document.createElement('div')
  overlay.className = 'marquee'
  overlay.hidden = true
  container.appendChild(overlay)

  let startClient: Position | null = null
  let activePointerId: number | null = null
  // Nodes that were already selected before this marquee gesture began -
  // the marquee only ever adds to this set, never removes from it, so
  // shrinking the rectangle away from a pre-existing selection never
  // deselects it.
  let preExistingSelectedIds = new Set<string>()
  // Nodes this marquee gesture itself has selected so far - these (and
  // only these) are un-selected again if the rectangle shrinks away from
  // them before the gesture ends.
  let marqueeSelectedIds = new Set<string>()

  const onPointerDown = (event: PointerEvent): void => {
    if (!event.shiftKey) return
    if (event.pointerType !== 'mouse' || event.button !== 0) return
    if (isMarqueeBlockedTarget(event.target)) return

    startClient = { x: event.clientX, y: event.clientY }
    activePointerId = event.pointerId
    preExistingSelectedIds = new Set(
      editor
        .getNodes()
        .filter((node) => node.selected)
        .map((node) => node.id),
    )
    marqueeSelectedIds = new Set()

    container.setPointerCapture(event.pointerId)
    overlay.hidden = false
    renderOverlay(normalizeRect(startClient, startClient))
    event.preventDefault()
  }

  const onPointerMove = (event: PointerEvent): void => {
    if (activePointerId !== event.pointerId || !startClient) return
    const rect = normalizeRect(startClient, { x: event.clientX, y: event.clientY })
    renderOverlay(rect)
    void applySelection(rect)
  }

  const onPointerUp = (event: PointerEvent): void => {
    if (activePointerId !== event.pointerId) return
    activePointerId = null
    startClient = null
    overlay.hidden = true
  }

  function renderOverlay(rect: Rect): void {
    const containerRect = container.getBoundingClientRect()
    overlay.style.left = `${rect.x - containerRect.left}px`
    overlay.style.top = `${rect.y - containerRect.top}px`
    overlay.style.width = `${rect.width}px`
    overlay.style.height = `${rect.height}px`
  }

  async function applySelection(rect: Rect): Promise<void> {
    for (const node of editor.getNodes()) {
      const view = area.nodeViews.get(node.id)
      if (!view) continue

      const intersects = rectsIntersect(rect, clientRectOf(view.element))
      const isMarqueeOwned = marqueeSelectedIds.has(node.id)

      if (intersects && !preExistingSelectedIds.has(node.id) && !isMarqueeOwned) {
        marqueeSelectedIds.add(node.id)
        await nodeSelection.select(node.id, true)
      } else if (!intersects && isMarqueeOwned) {
        marqueeSelectedIds.delete(node.id)
        await nodeSelection.unselect(node.id)
      }
    }
  }

  container.addEventListener('pointerdown', onPointerDown)
  container.addEventListener('pointermove', onPointerMove)
  container.addEventListener('pointerup', onPointerUp)
  container.addEventListener('pointercancel', onPointerUp)

  return () => {
    container.removeEventListener('pointerdown', onPointerDown)
    container.removeEventListener('pointermove', onPointerMove)
    container.removeEventListener('pointerup', onPointerUp)
    container.removeEventListener('pointercancel', onPointerUp)
    overlay.remove()
  }
}

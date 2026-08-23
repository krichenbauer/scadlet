/**
 * Structural subset of `AreaPlugin` needed to reorder a node's DOM
 * element to the front. Kept minimal (rather than importing the real
 * `AreaPlugin` type) so this logic is unit-testable with a plain fake
 * object instead of a real Rete/DOM instance.
 */
export interface NodeOrderArea {
  nodeViews: { get(id: string): { element: HTMLElement } | undefined }
  area: { content: { reorder(target: HTMLElement, next: ChildNode | null): unknown } }
}

/**
 * Moves a node's DOM element to the end of its siblings so it paints
 * above neighboring nodes. Reuses the exact same `Area.content.reorder`
 * mechanism `AreaExtensions.simpleNodesOrder` already applies on
 * `nodepicked`/`connectioncreated` (see `editor.ts`) - this is just also
 * triggered eagerly on hover start (`render.ts`), before the
 * presentation manager's hover-expand delay elapses, so a node is
 * already brought forward by the time it visually expands. No z-index
 * bookkeeping is introduced; DOM order alone determines paint order for
 * these `position: absolute` node elements.
 *
 * Skips the reorder entirely when the element is already last (already
 * frontmost): moving a node in the DOM while the pointer sits over it
 * makes the browser re-evaluate hit-testing under the cursor, which
 * re-fires `pointerenter` on the very same element - and since
 * `render.ts` calls this on every `pointerenter`, an unconditional
 * reorder here would retrigger itself every frame, permanently
 * resetting the presentation manager's hover-expand timer before it can
 * ever elapse. Reordering only when necessary keeps this idempotent.
 */
export function bringNodeToFront(area: NodeOrderArea, nodeId: string): void {
  const view = area.nodeViews.get(nodeId)
  if (!view) return
  if (view.element.parentElement?.lastElementChild === view.element) return
  area.area.content.reorder(view.element, null)
}

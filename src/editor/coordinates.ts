export interface Position {
  x: number
  y: number
}

export interface AreaTransform {
  x: number
  y: number
  k: number
}

/**
 * Converts a client-space point (e.g. `event.clientX/Y`, viewport-
 * relative) into the Rete graph's own coordinate space, accounting for:
 *  - the area container's page offset (`containerRect.left/top`)
 *  - the current pan (`transform.x/y`)
 *  - the current zoom (`transform.k`)
 *
 * `rete-area-plugin` positions its content holder with
 * `translate(transform.x, transform.y) scale(transform.k)` relative to
 * its container, and positions each node with
 * `translate(node.x, node.y)` inside that holder - so inverting exactly
 * that transform is what recovers correct graph coordinates from a raw
 * pointer/drop position. Pure and DOM-free beyond the already-resolved
 * `containerRect`, so it's directly unit-testable.
 */
export function clientToGraphPosition(
  client: Position,
  containerRect: Pick<DOMRect, 'left' | 'top'>,
  transform: AreaTransform,
): Position {
  return {
    x: (client.x - containerRect.left - transform.x) / transform.k,
    y: (client.y - containerRect.top - transform.y) / transform.k,
  }
}

/**
 * Whether a port's label is worth rendering as visible text next to its
 * socket. A label that just restates the socket's data type (e.g. a lone
 * "Geometry" output labeled "Geometry") is redundant once the socket's
 * color already communicates that type - the intended visual language
 * is "socket color communicates the value/data type; type text does not
 * need to be permanently displayed beside every connector". A label that
 * actually distinguishes one port from a sibling on the same side (e.g.
 * Difference's "Base"/"Subtract") is never redundant and stays visible,
 * since position alone can't disambiguate two inputs stacked on the same
 * edge.
 */
export function isRedundantTypeLabel(label: string | undefined, socketName: string): boolean {
  if (label === undefined) return true
  return label.trim().toLowerCase() === socketName.trim().toLowerCase()
}

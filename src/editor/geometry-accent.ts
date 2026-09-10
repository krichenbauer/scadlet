import type { NodeCatalogEntry } from './node-catalog'

/**
 * Presentation-only Geometry classification.  The Rete output ports are the
 * authority: labels, node names, categories, and generated OpenSCAD are never
 * consulted.  Keeping this small predicate separate makes the dynamic Module
 * Inputs signature naturally re-classify on every renderer update.
 */
export function hasGeometryOutput(
  outputs: Readonly<Record<string, { socket?: { name?: string } } | undefined>>,
): boolean {
  return Object.values(outputs).some((output) => output?.socket?.name === 'geometry')
}

/** The catalog counterpart used before a palette item has instantiated a
 * live Rete node.  It uses the catalog's semantic output-port typing, not a
 * category or display label. */
export function catalogProducesGeometry(entry: Pick<NodeCatalogEntry, 'outputs' | 'outputSocketType'>): boolean {
  return entry.outputs.some((port) => entry.outputSocketType(port) === 'geometry')
}

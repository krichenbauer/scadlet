import type { NodeCatalogEntry } from './node-catalog'
import type { ClassicPreset } from 'rete'
import { geometrySocket } from './sockets'

/**
 * Presentation-only Geometry classification.  The Rete output ports are the
 * authority: labels, node names, categories, and generated OpenSCAD are never
 * consulted.  Keeping this small predicate separate makes the dynamic Module
 * Inputs signature naturally re-classify on every renderer update.
 */
export function hasGeometryOutput(
  outputs: Readonly<Record<string, { socket?: ClassicPreset.Socket } | undefined>>,
): boolean {
  return Object.values(outputs).some((output) => output?.socket === geometrySocket)
}

/** The catalog counterpart used before a palette item has instantiated a
 * live Rete node. It uses semantic output typing, with explicit presentation
 * metadata for the For palette entry whose header output is structural. */
export function catalogProducesGeometry(entry: Pick<NodeCatalogEntry, 'outputs' | 'outputSocketType' | 'paletteGeometry'>): boolean {
  return Boolean(entry.paletteGeometry) || entry.outputs.some((port) => entry.outputSocketType(port) === 'geometry')
}

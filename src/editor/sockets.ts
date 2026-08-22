import { ClassicPreset } from 'rete'

/**
 * The only socket type needed so far: a 3D geometry value flowing from
 * one node's output into another node's input. Reused by every geometry
 * node (Cube now, transformations/CSG later).
 */
export const geometrySocket = new ClassicPreset.Socket('geometry')

/**
 * The value carried by a `geometry` socket during dataflow evaluation: an
 * OpenSCAD source fragment for the node's geometry (e.g. `cube(10);`).
 * Composition nodes (e.g. Difference) don't calculate geometry themselves
 * and can be missing a required input, so `error` lets them report that
 * without throwing or producing misleading OpenSCAD.
 */
export interface GeometryValue {
  code: string
  error?: string
}

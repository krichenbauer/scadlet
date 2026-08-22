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
 * Kept intentionally minimal - just enough for a node to hand its
 * generated statement to whatever consumes it (nothing consumes it yet,
 * since transformations/CSG nodes don't exist).
 */
export interface GeometryValue {
  code: string
}

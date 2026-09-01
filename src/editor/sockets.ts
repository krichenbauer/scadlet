import { ClassicPreset } from 'rete'

/**
 * The only socket type needed so far: a 3D geometry value flowing from
 * one node's output into another node's input. Reused by every geometry
 * node (Cube now, transformations/CSG later).
 */
export const geometrySocket = new ClassicPreset.Socket('geometry')
/** Scalar OpenSCAD expression input. Kept separate from geometry so an
 * accidental geometry-to-parameter connection is rejected by Rete. */
export const numberSocket = new ClassicPreset.Socket('number')
/** A complete OpenSCAD three-component vector expression input. */
export const vector3Socket = new ClassicPreset.Socket('vector3')

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

/** Values deliberately carry source expressions, rather than JavaScript
 * numbers, so future Number/Vector nodes can participate without a second
 * code-generation path. Inline controls simply produce the same strings. */
export interface NumberValue { code: string }
export interface Vector3Value { code: string }

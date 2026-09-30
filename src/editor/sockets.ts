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
/** A boolean OpenSCAD expression input, used for flags such as `center`. */
export const booleanSocket = new ClassicPreset.Socket('boolean')
/** Function Output's single input before its result type is inferred. Never
 * a real diagonal-compatible type: `connection-compatibility.ts` special-
 * cases this exact port to accept any of Number/Boolean/Vector3, so the
 * general diagonal-only rule below never needs to know about it. Purely a
 * neutral/grey rendering marker (see `node-editor.ts`'s socket CSS) until
 * the Function's result is resolved and this port is swapped for a real
 * typed socket. */
export const unresolvedSocket = new ClassicPreset.Socket('unresolved')
/** A fixed relationship between two ordinary visible nodes. Structural
 * sockets are rendered as anchors, not user-connectable data ports. */
export const structureSocket = new ClassicPreset.Socket('structure')

/** The small, closed socket vocabulary supported before Milestone 7 adds
 * production value nodes. Connections are deliberately diagonal only:
 * SCADlet never inserts an implicit OpenSCAD conversion. */
export type SocketType = 'geometry' | 'number' | 'vector3' | 'boolean' | 'structure'

export function socketType(socket: ClassicPreset.Socket | undefined): SocketType | undefined {
  switch (socket?.name) {
    case 'geometry':
    case 'number':
    case 'vector3':
    case 'boolean':
    case 'structure':
      return socket.name
    default:
      return undefined
  }
}

/** Socket types an ordinary connection can use; `structure` is the fixed
 * For boundary and never a connection target or source. */
export function isConnectableSocketType(type: string | undefined): type is Exclude<SocketType, 'structure'> {
  return type === 'geometry' || type === 'number' || type === 'vector3' || type === 'boolean'
}

/**
 * Whether a node has the conventional main Geometry output - the one Main
 * source roots and Inspect evaluate. It is typed by socket, so a lookalike
 * port cannot qualify. Dynamic `geometry:<id>` outputs (Module Inputs) are
 * not a main output; styling uses the broader `hasGeometryOutput`.
 */
export function hasMainGeometryOutput(outputs: Readonly<Record<string, { socket?: ClassicPreset.Socket } | undefined>>): boolean {
  return outputs.geometry?.socket === geometrySocket
}

export function areSocketTypesCompatible(
  source: ClassicPreset.Socket | undefined,
  target: ClassicPreset.Socket | undefined,
): boolean {
  const sourceType = socketType(source)
  return sourceType !== undefined && sourceType === socketType(target)
}

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
export interface BooleanValue { code: string }

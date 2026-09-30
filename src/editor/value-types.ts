import type { ClassicPreset } from 'rete'

import { booleanSocket, numberSocket, vector3Socket } from './sockets'

/**
 * SCADlet's closed vocabulary of value types - the single definition used by
 * parameters, Function results, Conditional branches, bindings, sockets, and
 * `.scadlet` validation. Adding a type (e.g. List or String) starts here.
 */
export const VALUE_TYPES = ['number', 'boolean', 'vector3'] as const

export type ValueType = typeof VALUE_TYPES[number]

export function isValueType(value: unknown): value is ValueType {
  return typeof value === 'string' && (VALUE_TYPES as readonly string[]).includes(value)
}

const VALUE_TYPE_SOCKETS: Readonly<Record<ValueType, ClassicPreset.Socket>> = {
  number: numberSocket,
  boolean: booleanSocket,
  vector3: vector3Socket,
}

/** The Rete socket carrying values of `type`. */
export function valueTypeSocket(type: ValueType): ClassicPreset.Socket {
  return VALUE_TYPE_SOCKETS[type]
}

/** The value type of a Value node's catalog type (`number`, `boolean`,
 * `vector3` are named after the type they hold), or `undefined`. */
export function valueNodeType(nodeType: string): ValueType | undefined {
  return isValueType(nodeType) ? nodeType : undefined
}

/** Whether a persisted/snapshotted node record is a Value that defines a
 * named binding (a label-only Value has no `bindingId`). */
export function isBoundValueRecord(node: { type: string; parameters: Record<string, unknown> }): boolean {
  return isValueType(node.type) && typeof node.parameters.bindingId === 'string'
}

import { describe, expect, it } from 'vitest'

import { booleanSocket, geometrySocket, hasMainGeometryOutput, isConnectableSocketType, numberSocket, vector3Socket } from './sockets'
import { isBoundValueRecord, isValueType, VALUE_TYPES, valueNodeType, valueTypeSocket } from './value-types'

describe('value types', () => {
  it('defines the closed value vocabulary once, with its sockets', () => {
    expect(VALUE_TYPES).toEqual(['number', 'boolean', 'vector3'])
    expect(VALUE_TYPES.map(valueTypeSocket)).toEqual([numberSocket, booleanSocket, vector3Socket])
    for (const type of VALUE_TYPES) expect(isValueType(type)).toBe(true)
    for (const other of ['geometry', 'structure', 'unresolved', 'Number', '', undefined, 3]) expect(isValueType(other)).toBe(false)
  })

  it('maps Value node types and recognizes bound Value records only', () => {
    expect(valueNodeType('vector3')).toBe('vector3')
    expect(valueNodeType('for')).toBeUndefined()
    expect(isBoundValueRecord({ type: 'number', parameters: { bindingId: 'b', name: 'n' } })).toBe(true)
    expect(isBoundValueRecord({ type: 'number', parameters: { name: 'Number' } })).toBe(false)
    expect(isBoundValueRecord({ type: 'for', parameters: { bindingId: 'b' } })).toBe(false)
  })
})

describe('socket classification', () => {
  it('lists the connectable socket types without the structural For boundary', () => {
    for (const type of ['geometry', 'number', 'vector3', 'boolean']) expect(isConnectableSocketType(type)).toBe(true)
    for (const type of ['structure', 'unresolved', undefined]) expect(isConnectableSocketType(type)).toBe(false)
  })

  it('finds a main Geometry output by its socket, never by a lookalike port', () => {
    expect(hasMainGeometryOutput({ geometry: { socket: geometrySocket } })).toBe(true)
    expect(hasMainGeometryOutput({ geometry: { socket: numberSocket } })).toBe(false)
    expect(hasMainGeometryOutput({ 'geometry:child': { socket: geometrySocket } })).toBe(false)
    expect(hasMainGeometryOutput({ value: { socket: numberSocket } })).toBe(false)
  })
})

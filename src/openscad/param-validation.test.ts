import { describe, expect, it } from 'vitest'

import {
  requireBoolean,
  requireFiniteNumber,
  requireOneOf,
  requireOptionalFiniteNumber,
  requireParamsObject,
} from './param-validation'

describe('requireParamsObject', () => {
  it('accepts a plain object', () => {
    expect(requireParamsObject({ a: 1 }, 'X')).toEqual({ a: 1 })
  })

  it.each([null, 42, 'str', true, [1, 2]])('rejects %p', (value) => {
    expect(() => requireParamsObject(value, 'X parameters')).toThrow('Invalid X parameters')
  })
})

describe('requireFiniteNumber', () => {
  it('accepts finite numbers, including negative and fractional', () => {
    expect(requireFiniteNumber(5, 'x')).toBe(5)
    expect(requireFiniteNumber(-3.5, 'x')).toBe(-3.5)
    expect(requireFiniteNumber(0, 'x')).toBe(0)
  })

  it.each([NaN, Infinity, -Infinity, '5', null, undefined, {}])('rejects %p', (value) => {
    expect(() => requireFiniteNumber(value, 'X parameter "x"')).toThrow('Invalid X parameter "x"')
  })
})

describe('requireOptionalFiniteNumber', () => {
  it('passes undefined through', () => {
    expect(requireOptionalFiniteNumber(undefined, 'x')).toBeUndefined()
  })

  it('validates a defined value', () => {
    expect(requireOptionalFiniteNumber(50, 'x')).toBe(50)
    expect(() => requireOptionalFiniteNumber(NaN, 'x')).toThrow('Invalid x')
  })
})

describe('requireBoolean', () => {
  it('accepts true/false', () => {
    expect(requireBoolean(true, 'x')).toBe(true)
    expect(requireBoolean(false, 'x')).toBe(false)
  })

  it.each(['true', 1, null, undefined])('rejects %p', (value) => {
    expect(() => requireBoolean(value, 'x')).toThrow('Invalid x')
  })
})

describe('requireOneOf', () => {
  it('accepts a listed option', () => {
    expect(requireOneOf('radius', ['radius', 'diameter'] as const, 'mode')).toBe('radius')
  })

  it('rejects an unlisted string with the allowed options in the message', () => {
    expect(() => requireOneOf('bogus', ['radius', 'diameter'] as const, 'mode')).toThrow(
      'Invalid mode: expected one of radius, diameter',
    )
  })

  it('rejects a non-string', () => {
    expect(() => requireOneOf(5, ['radius', 'diameter'] as const, 'mode')).toThrow('Invalid mode')
  })
})

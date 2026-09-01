import { describe, expect, it } from 'vitest'

import { cylinderToOpenSCAD, DEFAULT_CYLINDER_PARAMS, validateCylinderParams } from './cylinder'

describe('cylinderToOpenSCAD', () => {
  it('renders a basic radius cylinder', () => {
    expect(cylinderToOpenSCAD(DEFAULT_CYLINDER_PARAMS)).toBe('cylinder(h=10, r=5);')
  })

  it('adds center=true when centered', () => {
    expect(cylinderToOpenSCAD({ ...DEFAULT_CYLINDER_PARAMS, center: true })).toBe(
      'cylinder(h=10, r=5, center=true);',
    )
  })

  it('renders diameter mode', () => {
    expect(cylinderToOpenSCAD({ ...DEFAULT_CYLINDER_PARAMS, mode: 'diameter', d: 12 })).toBe(
      'cylinder(h=10, d=12);',
    )
  })

  it('renders a tapered cylinder using r1/r2', () => {
    expect(cylinderToOpenSCAD({ ...DEFAULT_CYLINDER_PARAMS, mode: 'tapered', r1: 8, r2: 2 })).toBe(
      'cylinder(h=10, r1=8, r2=2);',
    )
  })

  it('adds $fn when set', () => {
    expect(cylinderToOpenSCAD({ ...DEFAULT_CYLINDER_PARAMS, fn: 6 })).toBe(
      'cylinder(h=10, r=5, $fn=6);',
    )
  })
})

describe('validateCylinderParams', () => {
  it('accepts each sizing mode with fn unset', () => {
    expect(validateCylinderParams(DEFAULT_CYLINDER_PARAMS)).toEqual(DEFAULT_CYLINDER_PARAMS)
  })

  it('accepts fn as a defined finite number', () => {
    expect(validateCylinderParams({ ...DEFAULT_CYLINDER_PARAMS, fn: 50 }).fn).toBe(50)
  })

  it('rejects a non-object value', () => {
    expect(() => validateCylinderParams(null)).toThrow('Invalid Cylinder parameters')
  })

  it('rejects an unknown mode', () => {
    expect(() => validateCylinderParams({ ...DEFAULT_CYLINDER_PARAMS, mode: 'bogus' })).toThrow(
      'Invalid Cylinder parameter "mode"',
    )
  })

  it('rejects a non-finite r1/r2', () => {
    expect(() => validateCylinderParams({ ...DEFAULT_CYLINDER_PARAMS, r1: NaN })).toThrow(
      'Invalid Cylinder parameter "r1"',
    )
  })

  it('rejects a non-numeric fn when present', () => {
    expect(() => validateCylinderParams({ ...DEFAULT_CYLINDER_PARAMS, fn: 'lots' })).toThrow(
      'Invalid Cylinder parameter "fn"',
    )
  })
})

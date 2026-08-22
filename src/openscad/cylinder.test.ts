import { describe, expect, it } from 'vitest'

import { cylinderToOpenSCAD, DEFAULT_CYLINDER_PARAMS } from './cylinder'

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

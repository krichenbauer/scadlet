import { describe, expect, it } from 'vitest'

import { DEFAULT_SPHERE_PARAMS, sphereToOpenSCAD } from './sphere'

describe('sphereToOpenSCAD', () => {
  it('renders the default radius form', () => {
    expect(sphereToOpenSCAD(DEFAULT_SPHERE_PARAMS)).toBe('sphere(r=5);')
  })

  it('renders a changed radius', () => {
    expect(sphereToOpenSCAD({ ...DEFAULT_SPHERE_PARAMS, r: 12.5 })).toBe('sphere(r=12.5);')
  })

  it('renders the diameter form', () => {
    expect(sphereToOpenSCAD({ ...DEFAULT_SPHERE_PARAMS, mode: 'diameter', d: 10 })).toBe('sphere(d=10);')
  })

  it('includes $fn when set', () => {
    expect(sphereToOpenSCAD({ ...DEFAULT_SPHERE_PARAMS, fn: 64 })).toBe('sphere(r=5, $fn=64);')
  })

  it('omits $fn when unset', () => {
    expect(sphereToOpenSCAD({ ...DEFAULT_SPHERE_PARAMS, fn: undefined })).toBe('sphere(r=5);')
  })
})

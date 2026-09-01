import { describe, expect, it } from 'vitest'

import { DEFAULT_SPHERE_PARAMS, sphereToOpenSCAD, validateSphereParams } from './sphere'

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

describe('validateSphereParams', () => {
  it('accepts radius mode with fn unset', () => {
    expect(validateSphereParams(DEFAULT_SPHERE_PARAMS)).toEqual(DEFAULT_SPHERE_PARAMS)
  })

  it('accepts diameter mode with fn set to a non-default value', () => {
    expect(validateSphereParams({ mode: 'diameter', r: 5, d: 12, fn: 50 })).toEqual({
      mode: 'diameter',
      r: 5,
      d: 12,
      fn: 50,
    })
  })

  it('rejects a non-object value', () => {
    expect(() => validateSphereParams(42)).toThrow('Invalid Sphere parameters')
  })

  it('rejects an unknown mode', () => {
    expect(() => validateSphereParams({ ...DEFAULT_SPHERE_PARAMS, mode: 'volume' })).toThrow(
      'Invalid Sphere parameter "mode"',
    )
  })

  it('rejects a non-finite r/d', () => {
    expect(() => validateSphereParams({ ...DEFAULT_SPHERE_PARAMS, r: Infinity })).toThrow(
      'Invalid Sphere parameter "r"',
    )
  })
})

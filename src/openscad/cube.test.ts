import { describe, expect, it } from 'vitest'

import { cubeToOpenSCAD, DEFAULT_CUBE_PARAMS } from './cube'

describe('cubeToOpenSCAD', () => {
  it('renders a scalar size for uniform dimensions', () => {
    expect(cubeToOpenSCAD({ sizeX: 10, sizeY: 10, sizeZ: 10, center: false })).toBe('cube(10);')
  })

  it('renders a vector size for non-uniform dimensions', () => {
    expect(cubeToOpenSCAD({ sizeX: 10, sizeY: 20, sizeZ: 30, center: false })).toBe(
      'cube([10, 20, 30]);',
    )
  })

  it('adds center=true when centered', () => {
    expect(cubeToOpenSCAD({ sizeX: 10, sizeY: 10, sizeZ: 10, center: true })).toBe(
      'cube(10, center=true);',
    )
  })

  it('omits center when false, matching OpenSCAD default', () => {
    expect(cubeToOpenSCAD({ sizeX: 5, sizeY: 5, sizeZ: 5, center: false })).toBe('cube(5);')
  })

  it('uses sensible defaults (10 unit cube, not centered)', () => {
    expect(cubeToOpenSCAD(DEFAULT_CUBE_PARAMS)).toBe('cube(10);')
  })
})

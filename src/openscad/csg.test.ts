import { describe, expect, it } from 'vitest'

import { differenceToOpenSCAD } from './csg'

describe('differenceToOpenSCAD', () => {
  it('wraps base and subtract fragments in a difference block', () => {
    expect(differenceToOpenSCAD('cube(10);', 'cylinder(h=10, r=5);')).toEqual({
      code: 'difference() {\n    cube(10);\n    cylinder(h=10, r=5);\n}',
    })
  })

  it('reports an error when the subtract input is missing', () => {
    const result = differenceToOpenSCAD('cube(10);', undefined)
    expect(result.error).toMatch(/subtract/)
    expect(result.code).toBe(`// ${result.error}`)
  })

  it('reports an error when both inputs are missing', () => {
    const result = differenceToOpenSCAD(undefined, undefined)
    expect(result.error).toMatch(/base/)
    expect(result.error).toMatch(/subtract/)
  })
})

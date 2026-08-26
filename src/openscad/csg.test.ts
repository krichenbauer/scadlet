import { describe, expect, it } from 'vitest'

import { differenceToOpenSCAD, intersectionToOpenSCAD, unionToOpenSCAD } from './csg'

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

describe('unionToOpenSCAD', () => {
  it('wraps both fragments in a union block, preserving order', () => {
    expect(unionToOpenSCAD('cube(10);', 'sphere(r=7);')).toEqual({
      code: 'union() {\n    cube(10);\n    sphere(r=7);\n}',
    })
  })

  it('nests inside another operation', () => {
    const union = unionToOpenSCAD('cube(10);', 'sphere(r=7);')
    const nested = differenceToOpenSCAD(union.code, 'cylinder(h=10, r=5);')
    expect(nested.code).toBe(
      'difference() {\n' +
        '    union() {\n' +
        '        cube(10);\n' +
        '        sphere(r=7);\n' +
        '    }\n' +
        '    cylinder(h=10, r=5);\n' +
        '}',
    )
  })

  it('reports an error naming the missing input(s)', () => {
    expect(unionToOpenSCAD(undefined, 'sphere(r=7);').error).toMatch(/^Union is missing its a/)
    expect(unionToOpenSCAD('cube(10);', undefined).error).toMatch(/b geometry input$/)
  })
})

describe('intersectionToOpenSCAD', () => {
  it('wraps both fragments in an intersection block, preserving order', () => {
    expect(intersectionToOpenSCAD('cube(10, center=true);', 'sphere(r=7);')).toEqual({
      code: 'intersection() {\n    cube(10, center=true);\n    sphere(r=7);\n}',
    })
  })

  it('nests outside another operation', () => {
    const inner = differenceToOpenSCAD('cube(10);', 'cylinder(h=10, r=5);')
    const nested = intersectionToOpenSCAD(inner.code, 'sphere(r=7);')
    expect(nested.code).toBe(
      'intersection() {\n' +
        '    difference() {\n' +
        '        cube(10);\n' +
        '        cylinder(h=10, r=5);\n' +
        '    }\n' +
        '    sphere(r=7);\n' +
        '}',
    )
  })

  it('reports an error when both inputs are missing', () => {
    const result = intersectionToOpenSCAD(undefined, undefined)
    expect(result.error).toBe('Intersection is missing its a and b geometry input')
  })
})

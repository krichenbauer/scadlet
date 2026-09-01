import { describe, expect, it } from 'vitest'

import {
  DEFAULT_ROTATE_PARAMS,
  DEFAULT_SCALE_PARAMS,
  DEFAULT_TRANSLATE_PARAMS,
  rotateToOpenSCAD,
  scaleToOpenSCAD,
  translateToOpenSCAD,
  validateVector3Params,
} from './transform'

describe('translateToOpenSCAD', () => {
  it('renders the default [0, 0, 0] vector', () => {
    expect(translateToOpenSCAD(DEFAULT_TRANSLATE_PARAMS, 'cube(10);')).toEqual({
      code: 'translate([0, 0, 0]) {\n    cube(10);\n}',
    })
  })

  it('renders arbitrary positive/negative/fractional values', () => {
    expect(translateToOpenSCAD({ x: 10, y: 0, z: -5.5 }, 'cube(10);')).toEqual({
      code: 'translate([10, 0, -5.5]) {\n    cube(10);\n}',
    })
  })

  it('nests generated geometry from another node', () => {
    const nested = translateToOpenSCAD({ x: 1, y: 2, z: 3 }, 'difference() {\n    cube(10);\n    sphere(r=5);\n}')
    expect(nested.code).toBe(
      'translate([1, 2, 3]) {\n' +
        '    difference() {\n' +
        '        cube(10);\n' +
        '        sphere(r=5);\n' +
        '    }\n' +
        '}',
    )
  })

  it('reports an error when the geometry input is missing', () => {
    const result = translateToOpenSCAD(DEFAULT_TRANSLATE_PARAMS, undefined)
    expect(result.error).toBe('Translate is missing its geometry input')
    expect(result.code).toBe(`// ${result.error}`)
  })
})

describe('rotateToOpenSCAD', () => {
  it('renders the default [0, 0, 0] vector', () => {
    expect(rotateToOpenSCAD(DEFAULT_ROTATE_PARAMS, 'cube(10);')).toEqual({
      code: 'rotate([0, 0, 0]) {\n    cube(10);\n}',
    })
  })

  it('renders an arbitrary rotation', () => {
    expect(rotateToOpenSCAD({ x: 0, y: 0, z: 45 }, 'cube(10);')).toEqual({
      code: 'rotate([0, 0, 45]) {\n    cube(10);\n}',
    })
  })

  it('nests generated geometry from another node', () => {
    const nested = rotateToOpenSCAD({ x: 0, y: 0, z: 45 }, 'sphere(r=5);')
    expect(nested.code).toBe('rotate([0, 0, 45]) {\n    sphere(r=5);\n}')
  })

  it('reports an error when the geometry input is missing', () => {
    expect(rotateToOpenSCAD(DEFAULT_ROTATE_PARAMS, undefined).error).toBe(
      'Rotate is missing its geometry input',
    )
  })
})

describe('scaleToOpenSCAD', () => {
  it('renders the default [1, 1, 1] vector', () => {
    expect(scaleToOpenSCAD(DEFAULT_SCALE_PARAMS, 'sphere(r=5);')).toEqual({
      code: 'scale([1, 1, 1]) {\n    sphere(r=5);\n}',
    })
  })

  it('renders non-uniform scaling', () => {
    expect(scaleToOpenSCAD({ x: 2, y: 1, z: 0.5 }, 'sphere(r=5);')).toEqual({
      code: 'scale([2, 1, 0.5]) {\n    sphere(r=5);\n}',
    })
  })

  it('nests generated geometry from another node', () => {
    const nested = scaleToOpenSCAD({ x: 2, y: 1, z: 0.5 }, 'union() {\n    cube(10);\n    sphere(r=5);\n}')
    expect(nested.code).toBe(
      'scale([2, 1, 0.5]) {\n' + '    union() {\n' + '        cube(10);\n' + '        sphere(r=5);\n' + '    }\n' + '}',
    )
  })

  it('reports an error when the geometry input is missing', () => {
    expect(scaleToOpenSCAD(DEFAULT_SCALE_PARAMS, undefined).error).toBe('Scale is missing its geometry input')
  })
})

describe('validateVector3Params', () => {
  it('accepts positive, negative, and fractional values', () => {
    expect(validateVector3Params({ x: 10, y: -5.5, z: 0 }, 'Translate')).toEqual({ x: 10, y: -5.5, z: 0 })
  })

  it('rejects a non-object value', () => {
    expect(() => validateVector3Params(null, 'Translate')).toThrow('Invalid Translate parameters')
  })

  it('rejects a non-finite component, naming both the node type and the axis', () => {
    expect(() => validateVector3Params({ x: 1, y: NaN, z: 1 }, 'Rotate')).toThrow(
      'Invalid Rotate parameter "y"',
    )
  })

  it('rejects a missing component', () => {
    expect(() => validateVector3Params({ x: 1, y: 1 }, 'Scale')).toThrow('Invalid Scale parameter "z"')
  })
})

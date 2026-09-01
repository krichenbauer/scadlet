import { describe, expect, it } from 'vitest'

import { CubeNode } from './cube-node'
import { CylinderNode } from './cylinder-node'
import { RotateNode } from './rotate-node'
import { ScaleNode } from './scale-node'
import { SphereNode } from './sphere-node'
import { TranslateNode } from './translate-node'
import { UnionNode } from './union-node'
import { parseScadletProject } from '../../persistence/validate'
import { findCatalogEntry } from '../node-catalog'

function addCubeSize(cube: CubeNode, representation: 'scalar' | 'xyz' | 'vector'): void {
  const action = cube.controls.actions.actions().find((item) => item.id === 'add-size')
  const choice = action?.children?.find((item) => item.id === `add-size-${representation}`)
  choice?.run?.()
}

describe('Milestone 6 semantic node signatures', () => {
  it('a catalog-style fresh Cube emits OpenSCADs empty legal signature', () => {
    expect(new CubeNode({}, () => {}).data({}).geometry.code).toBe('cube();')
  })

  it('a Number connection replaces the preserved Cube size literal', () => {
    const cube = new CubeNode({ size: 10 }, () => {})
    expect(cube.data({ size: [{ code: 'width' }] }).geometry.code).toBe('cube(width);')
    expect(cube.getPersistedParams()).toMatchObject({ size: 10, sizeRepresentation: 'scalar' })
  })

  it('adds exactly the ports for the chosen Size representation', () => {
    const scalar = new CubeNode({}, () => {})
    addCubeSize(scalar, 'scalar')
    expect(Object.keys(scalar.inputs)).toEqual(['size'])

    const xyz = new CubeNode({}, () => {})
    addCubeSize(xyz, 'xyz')
    expect(Object.keys(xyz.inputs)).toEqual(['sizeX', 'sizeY', 'sizeZ'])

    const vector = new CubeNode({}, () => {})
    addCubeSize(vector, 'vector')
    expect(Object.keys(vector.inputs)).toEqual(['sizeVector'])
  })

  it('generates Scalar, mixed XYZ, and Vector representations without inactive fallbacks', () => {
    const scalar = new CubeNode({ size: 20 }, () => {})
    expect(scalar.data({}).geometry.code).toBe('cube(20);')

    const xyz = new CubeNode({ size: { x: 20, y: 10, z: 10 } }, () => {})
    expect(xyz.data({ sizeZ: [{ code: 'height' }] }).geometry.code).toBe('cube([20, 10, height]);')

    const vector = new CubeNode({ sizeRepresentation: 'vector' }, () => {})
    expect(vector.data({ sizeVector: [{ code: 'dimensions' }] }).geometry.code).toBe('cube(dimensions);')
  })

  it('preserves scalar and XYZ literals across representation switches', () => {
    const cube = new CubeNode({ size: 20 }, () => {})
    cube.controls.sizeMode!.setValue('xyz')
    cube.controls.sizeX!.setValue(20)
    cube.controls.sizeY!.setValue(10)
    cube.controls.sizeZ!.setValue(5)
    cube.controls.sizeMode!.setValue('scalar')
    expect(cube.controls.size!.value).toBe(20)
    cube.controls.sizeMode!.setValue('xyz')
    expect([cube.controls.sizeX!.value, cube.controls.sizeY!.value, cube.controls.sizeZ!.value]).toEqual([20, 10, 5])
  })

  it('round-trips the active representation and both stored literal forms through v2 catalog state', () => {
    const entry = findCatalogEntry('cube')!
    const original = new CubeNode({ size: 20 }, () => {})
    original.controls.sizeMode!.setValue('xyz')
    original.controls.sizeX!.setValue(20)
    original.controls.sizeY!.setValue(10)
    original.controls.sizeZ!.setValue(5)
    original.controls.sizeMode!.setValue('vector')
    const restored = entry.create({ onControlsChanged: () => {} }, entry.serializeParams(original)) as CubeNode
    expect(restored.getPersistedParams()).toMatchObject({
      sizeRepresentation: 'vector', sizeScalar: 20, sizeVector: { x: 20, y: 10, z: 5 },
    })
    expect(Object.keys(restored.inputs)).toEqual(['sizeVector'])
  })

  it('marks persistent add and representation switch actions dirty, not menu inspection', () => {
    let dirtyCount = 0
    const cube = new CubeNode({}, () => { dirtyCount += 1 })
    expect(dirtyCount).toBe(0)
    addCubeSize(cube, 'scalar')
    expect(dirtyCount).toBe(1)
    cube.controls.sizeMode!.setValue('xyz')
    expect(dirtyCount).toBe(2)
  })

  it('uses exactly one active vector representation and preserves XYZ literals', () => {
    const transform = new TranslateNode({ x: 1, y: 2, z: 3 })
    expect(Object.keys(transform.inputs)).toEqual(['geometry', 'x', 'y', 'z'])
    transform.controls.vectorMode.setValue('vector')
    expect(Object.keys(transform.inputs)).toEqual(['geometry', 'vector'])
    expect(transform.data({ geometry: [{ code: 'cube();' }], vector: [{ code: 'offset' }] }).geometry.code).toBe(
      'translate(offset) {\n    cube();\n}',
    )
    transform.controls.vectorMode.setValue('xyz')
    expect([transform.controls.x.value, transform.controls.y.value, transform.controls.z.value]).toEqual([1, 2, 3])
  })

  it('shares the vector representation contract across Rotate and Scale', () => {
    const rotate = new RotateNode({ x: 0, y: 90, z: 45, representation: 'vector' })
    const scale = new ScaleNode({ x: 2, y: 3, z: 4 })
    expect(Object.keys(rotate.inputs)).toEqual(['geometry', 'vector'])
    expect(rotate.data({ geometry: [{ code: 'cube();' }], vector: [{ code: 'angles' }] }).geometry.code).toBe('rotate(angles) {\n    cube();\n}')
    expect(Object.keys(scale.inputs)).toEqual(['geometry', 'x', 'y', 'z'])
    expect(scale.data({ geometry: [{ code: 'cube();' }], y: [{ code: 'factor' }] }).geometry.code).toBe('scale([2, factor, 4]) {\n    cube();\n}')
  })

  it('refuses a representation switch when the active ports are connected', () => {
    const transform = new TranslateNode({ x: 1, y: 2, z: 3 }, undefined, () => false)
    transform.controls.vectorMode.setValue('vector')
    expect(transform.controls.vectorMode.value).toBe('xyz')
    expect(Object.keys(transform.inputs)).toEqual(['geometry', 'x', 'y', 'z'])

    const cube = new CubeNode({ size: 10 }, undefined, () => false)
    cube.controls.sizeMode!.setValue('xyz')
    expect(cube.controls.sizeMode!.value).toBe('scalar')
    expect(Object.keys(cube.inputs)).toContain('size')
  })

  it('keeps only active Cylinder and Sphere sizing ports', () => {
    const cylinder = new CylinderNode({ mode: 'tapered', r1: 3, r2: 1 }, () => {})
    expect(Object.keys(cylinder.inputs)).toEqual(['r1', 'r2'])
    cylinder.controls.mode.setValue('diameter')
    expect(Object.keys(cylinder.inputs)).toEqual(['d'])
    const sphere = new SphereNode({ mode: 'radius', r: 5 }, () => {})
    expect(Object.keys(sphere.inputs)).toEqual(['r'])
    sphere.controls.mode.setValue('diameter')
    expect(Object.keys(sphere.inputs)).toEqual(['d'])
  })

  it('gives Center a Boolean socket whose connection overrides its checkbox literal', () => {
    const cube = new CubeNode({ size: 10, center: false }, () => {})
    expect(cube.inputs.center?.socket.name).toBe('boolean')
    expect(cube.data({ center: [{ code: 'is_centered' }] }).geometry.code).toBe('cube(10, center=is_centered);')
    cube.controls.center!.setValue(true)
    expect(cube.data({ center: [{ code: 'false' }] }).geometry.code).toBe('cube(10, center=false);')
    expect(cube.data({}).geometry.code).toBe('cube(10, center=true);')
    const cylinder = new CylinderNode({ h: 10, mode: 'radius', r: 5, center: false }, () => {})
    expect(cylinder.inputs.center?.socket.name).toBe('boolean')
    expect(cylinder.data({ center: [{ code: 'is_centered' }] }).geometry.code).toBe('cylinder(h=10, r=5, center=is_centered);')
  })

  it('round-trips a transform representation and retained XYZ literals through the v2 catalog state', () => {
    const entry = findCatalogEntry('translate')!
    const original = new TranslateNode({ x: 7, y: 8, z: 9 })
    original.controls.vectorMode.setValue('vector')
    const restored = entry.create({ onControlsChanged: () => {} }, entry.serializeParams(original)) as TranslateNode
    expect(restored.getPersistedParams()).toEqual({ x: 7, y: 8, z: 9, representation: 'vector' })
    expect(Object.keys(restored.inputs)).toEqual(['geometry', 'vector'])
    restored.controls.vectorMode.setValue('xyz')
    expect([restored.controls.x.value, restored.controls.y.value, restored.controls.z.value]).toEqual([7, 8, 9])
  })

  it('a variadic Union keeps ordered stable child ports and an extension slot', () => {
    const union = new UnionNode({}, false)
    const first = Object.keys(union.inputs)[0]!
    union.synchronizeChildren(new Set([first]))
    const ports = Object.keys(union.inputs)
    expect(ports).toHaveLength(2)
    expect(union.data({ [ports[0]!]: [{ code: 'cube();' }], [ports[1]!]: [{ code: 'sphere();' }] }).geometry.code).toBe(
      'union() {\n    cube();\n    sphere();\n}',
    )
  })

  it('migrates v1 Cube and fixed Union ports into v2 semantic identities', () => {
    const project = parseScadletProject({
      format: 'scadlet', version: 1, metadata: { name: 'Old' },
      graph: {
        nodes: [
          { id: 'cube', type: 'cube', position: { x: 0, y: 0 }, parameters: { sizeX: 2, sizeY: 3, sizeZ: 4, center: false } },
          { id: 'union', type: 'union', position: { x: 1, y: 0 }, parameters: {} },
        ],
        connections: [{ id: 'c', source: 'cube', sourceOutput: 'geometry', target: 'union', targetInput: 'a' }],
      },
      editor: { viewport: { x: 0, y: 0, zoom: 1 } }, viewer: { camera: { position: [0, 0, 0], target: [0, 0, 0] } },
    })
    expect(project.version).toBe(2)
    expect(project.graph.nodes[0]?.parameters).toEqual({ size: { x: 2, y: 3, z: 4 }, sizeRepresentation: 'xyz' })
    expect(project.graph.connections[0]?.targetInput).toBe('child:v1-a')
  })
})

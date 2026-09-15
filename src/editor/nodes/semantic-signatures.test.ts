import { describe, expect, it } from 'vitest'

import { CubeNode } from './cube-node'
import { CylinderNode } from './cylinder-node'
import { RotateNode } from './rotate-node'
import { ScaleNode } from './scale-node'
import { SphereNode } from './sphere-node'
import { TranslateNode } from './translate-node'
import { UnionNode } from './union-node'
import type { VectorTransformNode } from './vector-transform-node'
import { parseScadletProject } from '../../persistence/validate'
import { findCatalogEntry } from '../node-catalog'

function addCubeSize(cube: CubeNode, representation: 'scalar' | 'xyz' | 'vector'): void {
  const action = cube.controls.actions.actions().find((item) => item.id === 'add-size')
  const choice = action?.children?.find((item) => item.id === `add-size-${representation}`)
  choice?.run?.()
}

function removeCubeSize(cube: CubeNode): Promise<boolean> {
  const row = cube.removableRows().find((item) => item.key.startsWith('size'))
  return row ? row.requestRemove() : Promise.resolve(false)
}

function addCylinderSize(cylinder: CylinderNode, mode: 'radius' | 'diameter' | 'tapered'): void {
  const action = cylinder.controls.actions.actions().find((item) => item.id === 'add-size')
  const choice = action?.children?.find((item) => item.id === `add-size-${mode}`)
  choice?.run?.()
}

function removeCylinderSize(cylinder: CylinderNode): Promise<boolean> {
  const row = cylinder.removableRows().find((item) => ['r', 'd', 'r1', 'r2'].includes(item.key))
  return row ? row.requestRemove() : Promise.resolve(false)
}

function addSphereSize(sphere: SphereNode, mode: 'radius' | 'diameter'): void {
  const action = sphere.controls.actions.actions().find((item) => item.id === 'add-size')
  const choice = action?.children?.find((item) => item.id === `add-size-${mode}`)
  choice?.run?.()
}

function removeSphereSize(sphere: SphereNode): Promise<boolean> {
  const row = sphere.removableRows().find((item) => ['r', 'd'].includes(item.key))
  return row ? row.requestRemove() : Promise.resolve(false)
}

function addVectorForm(node: VectorTransformNode, representation: 'xyz' | 'vector'): void {
  const action = node.controls.actions.actions().find((item) => item.id === `add-${representation}`)
  action?.run?.()
}

function removeVectorForm(node: VectorTransformNode): Promise<boolean> {
  const row = node.removableRows()[0]
  return row ? row.requestRemove() : Promise.resolve(false)
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

  it('preserves scalar and XYZ literals across remove-then-add form changes', async () => {
    const cube = new CubeNode({ size: 20 }, () => {})
    await removeCubeSize(cube)
    addCubeSize(cube, 'xyz')
    cube.controls.sizeX!.setValue(20)
    cube.controls.sizeY!.setValue(10)
    cube.controls.sizeZ!.setValue(5)
    await removeCubeSize(cube)
    addCubeSize(cube, 'scalar')
    expect(cube.controls.size!.value).toBe(20)
    await removeCubeSize(cube)
    addCubeSize(cube, 'xyz')
    expect([cube.controls.sizeX!.value, cube.controls.sizeY!.value, cube.controls.sizeZ!.value]).toEqual([20, 10, 5])
  })

  it('round-trips the active representation and both stored literal forms through v2 catalog state', async () => {
    const entry = findCatalogEntry('cube')!
    const original = new CubeNode({ size: 20 }, () => {})
    await removeCubeSize(original)
    addCubeSize(original, 'xyz')
    original.controls.sizeX!.setValue(20)
    original.controls.sizeY!.setValue(10)
    original.controls.sizeZ!.setValue(5)
    await removeCubeSize(original)
    addCubeSize(original, 'vector')
    const restored = entry.create({ onControlsChanged: () => {} }, entry.serializeParams(original)) as CubeNode
    expect(restored.getPersistedParams()).toMatchObject({
      sizeRepresentation: 'vector', sizeScalar: 20, sizeVector: { x: 20, y: 10, z: 5 },
    })
    expect(Object.keys(restored.inputs)).toEqual(['sizeVector'])
  })

  it('marks persistent add and remove form actions dirty, not menu inspection', async () => {
    let dirtyCount = 0
    const cube = new CubeNode({}, () => { dirtyCount += 1 })
    expect(dirtyCount).toBe(0)
    addCubeSize(cube, 'scalar')
    expect(dirtyCount).toBe(1)
    await removeCubeSize(cube)
    expect(dirtyCount).toBe(2)
  })

  it('uses exactly one active vector representation and preserves XYZ literals across remove-then-add', async () => {
    const transform = new TranslateNode({ x: 1, y: 2, z: 3 })
    expect(Object.keys(transform.inputs)).toEqual(['geometry', 'x', 'y', 'z'])
    await removeVectorForm(transform)
    addVectorForm(transform, 'vector')
    expect(Object.keys(transform.inputs)).toEqual(['geometry', 'vector'])
    expect(transform.data({ geometry: [{ code: 'cube();' }], vector: [{ code: 'offset' }] }).geometry.code).toBe(
      'translate(offset) {\n    cube();\n}',
    )
    await removeVectorForm(transform)
    addVectorForm(transform, 'xyz')
    expect([transform.controls.x!.value, transform.controls.y!.value, transform.controls.z!.value]).toEqual([1, 2, 3])
  })

  it('shares the vector representation contract across Rotate and Scale', () => {
    const rotate = new RotateNode({ x: 0, y: 90, z: 45, representation: 'vector' })
    const scale = new ScaleNode({ x: 2, y: 3, z: 4 })
    expect(Object.keys(rotate.inputs)).toEqual(['geometry', 'vector'])
    expect(rotate.data({ geometry: [{ code: 'cube();' }], vector: [{ code: 'angles' }] }).geometry.code).toBe('rotate(angles) {\n    cube();\n}')
    expect(Object.keys(scale.inputs)).toEqual(['geometry', 'x', 'y', 'z'])
    expect(scale.data({ geometry: [{ code: 'cube();' }], y: [{ code: 'factor' }] }).geometry.code).toBe('scale([2, factor, 4]) {\n    cube();\n}')
  })

  it('removing the last Transform form leaves a syntactically valid, argument-less call that restores identically', () => {
    const transform = new TranslateNode({ x: 1, y: 2, z: 3 })
    return removeVectorForm(transform).then((removed) => {
      expect(removed).toBe(true)
      expect(Object.keys(transform.inputs)).toEqual(['geometry'])
      expect(transform.data({ geometry: [{ code: 'cube();' }] }).geometry.code).toBe('translate() {\n    cube();\n}')
      expect(transform.getPersistedParams().representation).toBe('none')
      const restored = new TranslateNode(transform.getPersistedParams())
      expect(Object.keys(restored.inputs)).toEqual(['geometry'])
      expect(restored.getPersistedParams().representation).toBe('none')
    })
  })

  it('refuses removing the active form when the confirm-gated callback resolves false (e.g. connected ports)', async () => {
    const transform = new TranslateNode({ x: 1, y: 2, z: 3 }, undefined, async () => false)
    expect(await removeVectorForm(transform)).toBe(false)
    expect(Object.keys(transform.inputs)).toEqual(['geometry', 'x', 'y', 'z'])

    const cube = new CubeNode({ size: 10 }, undefined, async () => false)
    expect(await removeCubeSize(cube)).toBe(false)
    expect(Object.keys(cube.inputs)).toContain('size')
  })

  it('keeps only active Cylinder and Sphere sizing ports across remove-then-add form changes', async () => {
    const cylinder = new CylinderNode({ mode: 'tapered', r1: 3, r2: 1 }, () => {})
    expect(Object.keys(cylinder.inputs)).toEqual(['r1', 'r2'])
    await removeCylinderSize(cylinder)
    addCylinderSize(cylinder, 'diameter')
    expect(Object.keys(cylinder.inputs)).toEqual(['d'])
    const sphere = new SphereNode({ mode: 'radius', r: 5 }, () => {})
    expect(Object.keys(sphere.inputs)).toEqual(['r'])
    await removeSphereSize(sphere)
    addSphereSize(sphere, 'diameter')
    expect(Object.keys(sphere.inputs)).toEqual(['d'])
  })

  it('blocks Cylinder and Sphere size removal when the confirm-gated callback resolves false', async () => {
    const cylinder = new CylinderNode({ mode: 'radius', r: 5 }, undefined, async () => false)
    expect(await removeCylinderSize(cylinder)).toBe(false)
    expect(Object.keys(cylinder.inputs)).toEqual(['r'])

    const sphere = new SphereNode({ mode: 'radius', r: 5 }, undefined, async () => false)
    expect(await removeSphereSize(sphere)).toBe(false)
    expect(Object.keys(sphere.inputs)).toEqual(['r'])
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

  it('round-trips a transform representation and retained XYZ literals through the v2 catalog state', async () => {
    const entry = findCatalogEntry('translate')!
    const original = new TranslateNode({ x: 7, y: 8, z: 9 })
    await removeVectorForm(original)
    addVectorForm(original, 'vector')
    const restored = entry.create({ onControlsChanged: () => {} }, entry.serializeParams(original)) as TranslateNode
    expect(restored.getPersistedParams()).toEqual({ x: 7, y: 8, z: 9, representation: 'vector' })
    expect(Object.keys(restored.inputs)).toEqual(['geometry', 'vector'])
    await removeVectorForm(restored)
    addVectorForm(restored, 'xyz')
    expect([restored.controls.x!.value, restored.controls.y!.value, restored.controls.z!.value]).toEqual([7, 8, 9])
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
    expect(project.version).toBe(7)
    expect(project.graph.nodes[0]?.parameters).toEqual({ size: { x: 2, y: 3, z: 4 }, sizeRepresentation: 'xyz' })
    expect(project.graph.connections[0]?.targetInput).toBe('child:v1-a')
  })
})

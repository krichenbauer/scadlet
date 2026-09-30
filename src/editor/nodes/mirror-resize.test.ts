import { describe, expect, it } from 'vitest'

import { CheckboxControl } from '../controls'
import { findCatalogEntry } from '../node-catalog'
import { CubeNode } from './cube-node'
import { CylinderNode } from './cylinder-node'
import { MirrorNode } from './mirror-node'
import { ResizeNode } from './resize-node'
import { ScadSettingsNode } from './scad-settings-node'
import { TranslateNode } from './translate-node'
import { parseScadletProject } from '../../persistence/validate'

const child = { geometry: [{ code: 'cube();' }] }
const run = (node: { controls: { actions: { actions(): readonly { id: string; run?: () => void }[] } } }, id: string): void => {
  const action = node.controls.actions.actions().find((item) => item.id === id)
  if (!action?.run) throw new Error(`Missing Add action ${id}`)
  action.run()
}

describe('Mirror', () => {
  it('starts argument-less like OpenSCAD and offers the vector forms', () => {
    const mirror = new MirrorNode()
    expect(mirror.data(child).geometry.code).toBe('mirror() {\n    cube();\n}')
    expect(mirror.getPersistedParams()).toEqual({ x: 1, y: 0, z: 0, representation: 'none' })
    expect(mirror.controls.actions.actions().map((item) => item.id)).toEqual(['add-xyz', 'add-vector'])
    expect(mirror.removableRows()).toEqual([])
  })

  it('adds an XYZ normal starting at X = 1 and accepts connected components or a whole vector', () => {
    const mirror = new MirrorNode()
    run(mirror, 'add-xyz')
    expect(mirror.data(child).geometry.code).toBe('mirror([1, 0, 0]) {\n    cube();\n}')
    expect(mirror.data({ ...child, y: [{ code: 'flip' }] }).geometry.code).toBe('mirror([1, flip, 0]) {\n    cube();\n}')
    const vector = new MirrorNode({ representation: 'vector' })
    expect(vector.data({ ...child, vector: [{ code: 'normal' }] }).geometry.code).toBe('mirror(normal) {\n    cube();\n}')
  })

  it('reports a missing Geometry input instead of emitting an empty mirror', () => {
    expect(new MirrorNode().data({}).geometry).toMatchObject({ error: 'Mirror is missing its geometry input' })
  })
})

describe('Resize', () => {
  it('starts argument-less and offers the vector forms plus Keep proportions', () => {
    const resize = new ResizeNode()
    expect(resize.data(child).geometry.code).toBe('resize() {\n    cube();\n}')
    expect(resize.getPersistedParams()).toEqual({ x: 10, y: 10, z: 10, representation: 'none' })
    expect(resize.controls.actions.actions().map((item) => item.id)).toEqual(['add-xyz', 'add-vector', 'add-auto'])
  })

  it('adds a 10 x 10 x 10 size and an enabled Keep proportions flag', () => {
    const resize = new ResizeNode()
    run(resize, 'add-xyz')
    run(resize, 'add-auto')
    expect(resize.controls.auto).toBeInstanceOf(CheckboxControl)
    expect(resize.data(child).geometry.code).toBe('resize([10, 10, 10], auto=true) {\n    cube();\n}')
    expect(resize.getPersistedParams()).toEqual({ x: 10, y: 10, z: 10, representation: 'xyz', auto: true })
    expect(resize.controls.actions.actions()).toEqual([])
    expect(resize.data({ ...child, auto: [{ code: 'keep' }] }).geometry.code).toBe('resize([10, 10, 10], auto=keep) {\n    cube();\n}')
  })

  it('removes Keep proportions through its own row and restores the argument-less call', async () => {
    const resize = new ResizeNode({ auto: false })
    expect(resize.data(child).geometry.code).toBe('resize(auto=false) {\n    cube();\n}')
    const row = resize.removableRows().find((item) => item.key === 'auto')!
    await expect(row.requestRemove()).resolves.toBe(true)
    expect(resize.inputs.auto).toBeUndefined()
    expect(resize.data(child).geometry.code).toBe('resize() {\n    cube();\n}')
    expect(resize.getPersistedParams()).not.toHaveProperty('auto')
  })

  it('validates and round-trips its parameters through the catalog', () => {
    const entry = findCatalogEntry('resize')!
    const params = { x: 20, y: 0, z: 0, representation: 'xyz', auto: true }
    expect(entry.serializeParams(entry.create({ onControlsChanged: () => {} }, entry.validateParams(params)))).toEqual(params)
    expect(() => entry.validateParams({ x: 1, y: 1, z: 1, auto: 'yes' })).toThrow('auto')
  })
})

describe('added-parameter defaults', () => {
  it('starts an added Center enabled, since leaving it out already means false', () => {
    const cube = new CubeNode({}, () => {})
    run(cube, 'add-center')
    expect(cube.getPersistedParams().center).toBe(true)
    const cylinder = new CylinderNode({}, () => {})
    run(cylinder, 'add-center')
    expect(cylinder.getPersistedParams().center).toBe(true)
  })

  it('starts an added tapered Cylinder as a visible cone', () => {
    const cylinder = new CylinderNode({}, () => {})
    const size = cylinder.controls.actions.actions().find((item) => item.id === 'add-size')!
    size.children!.find((item) => item.id === 'add-size-tapered')!.run!()
    expect(cylinder.getPersistedParams()).toMatchObject({ mode: 'tapered', r1: 5, r2: 2 })
  })

  it('starts added $fa and $fs finer than the OpenSCAD defaults they would otherwise repeat', () => {
    const settings = new ScadSettingsNode({}, () => {}, async () => true)
    run(settings, 'add-fa')
    run(settings, 'add-fs')
    expect(settings.getPersistedParams()).toEqual({ fa: 1, fs: 0.4 })
  })

  it('keeps Translate, Rotate, and Scale output unchanged by the explicit OpenSCAD name', () => {
    expect(new TranslateNode({ x: 1, y: 2, z: 3 }).data(child).geometry.code).toBe('translate([1, 2, 3]) {\n    cube();\n}')
  })
})

describe('Mirror and Resize persistence', () => {
  it('accepts both as additive v8 node types in Main', () => {
    const project = parseScadletProject({
      format: 'scadlet', version: 8, metadata: { name: 'Transforms' }, definitions: [],
      graph: {
        nodes: [
          { id: 'cube', type: 'cube', position: { x: 0, y: 0 }, parameters: {} },
          { id: 'mirror', type: 'mirror', position: { x: 200, y: 0 }, parameters: { x: 1, y: 0, z: 0 } },
          { id: 'resize', type: 'resize', position: { x: 400, y: 0 }, parameters: { x: 20, y: 0, z: 0, representation: 'xyz', auto: true } },
        ],
        connections: [
          { id: 'a', source: 'cube', sourceOutput: 'geometry', target: 'mirror', targetInput: 'geometry' },
          { id: 'b', source: 'mirror', sourceOutput: 'geometry', target: 'resize', targetInput: 'geometry' },
        ],
      },
      editor: { viewport: { x: 0, y: 0, zoom: 1 } }, viewer: { camera: { position: [80, 80, 60], target: [0, 0, 0] } },
    })
    expect(project.graph.nodes.map((node) => node.type)).toEqual(['cube', 'mirror', 'resize'])
  })
})

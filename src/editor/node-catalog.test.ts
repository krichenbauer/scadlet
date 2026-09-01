import { NodeEditor } from 'rete'
import { describe, expect, it, vi } from 'vitest'

import { findCatalogEntry, identifyNodeType, NODE_CATALOG, NODE_CATEGORIES } from './node-catalog'
import { CubeNode } from './nodes/cube-node'
import { CylinderNode } from './nodes/cylinder-node'
import type { Schemes } from './schemes'
import { t } from '../i18n/translate'

const noopContext = { onControlsChanged: () => {} }

describe('NODE_CATALOG', () => {
  it('contains all nine node types with stable, language-independent type ids', () => {
    const types = NODE_CATALOG.map((entry) => entry.type).sort()
    expect(types).toEqual(
      [
        'cube',
        'cylinder',
        'sphere',
        'translate',
        'rotate',
        'scale',
        'difference',
        'union',
        'intersection',
      ].sort(),
    )
  })

  it('assigns every entry to a category id that exists in NODE_CATEGORIES', () => {
    const categoryIds = new Set(NODE_CATEGORIES.map((category) => category.id))
    for (const entry of NODE_CATALOG) {
      expect(categoryIds.has(entry.category)).toBe(true)
    }
  })

  it('groups nodes under the expected category ids', () => {
    expect(findCatalogEntry('cube')?.category).toBe('primitives')
    expect(findCatalogEntry('cylinder')?.category).toBe('primitives')
    expect(findCatalogEntry('sphere')?.category).toBe('primitives')
    expect(findCatalogEntry('translate')?.category).toBe('transformations')
    expect(findCatalogEntry('rotate')?.category).toBe('transformations')
    expect(findCatalogEntry('scale')?.category).toBe('transformations')
    expect(findCatalogEntry('difference')?.category).toBe('boolean-operations')
    expect(findCatalogEntry('union')?.category).toBe('boolean-operations')
    expect(findCatalogEntry('intersection')?.category).toBe('boolean-operations')
  })

  it('never uses display strings (e.g. "CSG") as category ids', () => {
    const categoryIds = NODE_CATEGORIES.map((category) => category.id)
    expect(categoryIds).not.toContain('CSG')
    expect(categoryIds).not.toContain('Primitives')
  })

  it('resolves every labelKey through the translation layer to a non-empty, non-key string', () => {
    for (const entry of [...NODE_CATALOG, ...NODE_CATEGORIES]) {
      const label = t(entry.labelKey)
      expect(label).not.toBe('')
      expect(label).not.toBe(entry.labelKey)
    }
  })

  it('findCatalogEntry returns undefined for an unknown/untrusted type string', () => {
    expect(findCatalogEntry('not-a-real-type')).toBeUndefined()
  })

  it('create() builds a usable node instance without touching any existing graph state', async () => {
    const editor = new NodeEditor<Schemes>()
    const existingCube = new CubeNode()
    await editor.addNode(existingCube)

    const entry = findCatalogEntry('cylinder')!
    const created = entry.create(noopContext)
    await editor.addNode(created)

    expect(editor.getNodes()).toHaveLength(2)
    expect(editor.getNode(existingCube.id)).toBe(existingCube)
    expect(editor.getConnections()).toEqual([])
  })

  it('create() builds a usable instance for each of the six new node types', async () => {
    const editor = new NodeEditor<Schemes>()
    for (const type of ['sphere', 'translate', 'rotate', 'scale', 'union', 'intersection']) {
      const entry = findCatalogEntry(type)!
      const node = entry.create(noopContext)
      await editor.addNode(node)
    }
    expect(editor.getNodes()).toHaveLength(6)
  })

  it('every entry declares its stable input/output port ids', () => {
    expect(findCatalogEntry('cube')).toMatchObject({ inputs: [], outputs: ['geometry'] })
    expect(findCatalogEntry('translate')).toMatchObject({ inputs: ['geometry', 'vector', 'x', 'y', 'z'], outputs: ['geometry'] })
    expect(findCatalogEntry('difference')).toMatchObject({ inputs: ['base', 'subtract'], outputs: ['geometry'] })
    expect(findCatalogEntry('union')).toMatchObject({ inputs: [], outputs: ['geometry'] })
  })

  it('identifyNodeType recognizes a live node instance created by create()', () => {
    const cube = findCatalogEntry('cube')!.create(noopContext)
    const cylinder = findCatalogEntry('cylinder')!.create(noopContext)
    expect(identifyNodeType(cube)).toBe('cube')
    expect(identifyNodeType(cylinder)).toBe('cylinder')
  })

  it('identifyNodeType returns undefined for a node instance not built by any catalog entry', () => {
    class NotACatalogNode extends CubeNode {}
    // A subclass of CubeNode still IS a CubeNode via instanceof, so use an unrelated class shape instead.
    expect(identifyNodeType({} as unknown as Schemes['Node'])).toBeUndefined()
    void NotACatalogNode
  })

  it('serializeParams/create round-trips a node with non-default parameters (Cube)', () => {
    const entry = findCatalogEntry('cube')!
    const original = new CubeNode({ sizeX: 1, sizeY: 2, sizeZ: 3, center: true })
    const params = entry.serializeParams(original)
    const restored = entry.create(noopContext, params) as CubeNode
    expect(restored.getPersistedParams()).toEqual(original.getPersistedParams())
  })

  it('serializeParams/create round-trips a node with progressive-disclosure state (Cylinder, diameter mode + $fn)', () => {
    const entry = findCatalogEntry('cylinder')!
    const original = new CylinderNode({ mode: 'diameter', d: 12, fn: 50 })
    const params = entry.serializeParams(original)
    const restored = entry.create(noopContext, params) as CylinderNode
    expect(restored.getPersistedParams()).toEqual(original.getPersistedParams())
  })

  it('validateParams throws a descriptive error for a malformed parameter object', () => {
    expect(() => findCatalogEntry('cube')!.validateParams({ sizeX: 'oops' })).toThrow('Invalid Cube parameter "sizeX"')
  })

  it('validates the asymmetric Difference and persistent variadic Boolean slots', () => {
    expect(findCatalogEntry('difference')!.validateParams(undefined)).toEqual({})
    expect(findCatalogEntry('union')!.validateParams({ children: [{ id: 'child-1' }] })).toEqual({ children: [{ id: 'child-1' }] })
    expect(() => findCatalogEntry('intersection')!.validateParams('nope')).toThrow('Invalid parameters')
  })
})

/**
 * Protects the dirty-tracking bug this task fixes: editing a persisted
 * node parameter must mark the project dirty, through the actual
 * control-update mechanism (`control.setValue(...)`) rather than a test
 * calling some `markDirty()` shortcut directly. See `wireDirtyNotifications`
 * in `node-catalog.ts`.
 */
describe('NODE_CATALOG dirty-notification wiring', () => {
  function contextWithDirtySpy() {
    const notifyDirty = vi.fn()
    const context = { onControlsChanged: () => {}, notifyDirty }
    return { context, notifyDirty }
  }

  it('does NOT notify dirty merely from construction, even with non-default persisted parameters (restore safety)', () => {
    const { context, notifyDirty } = contextWithDirtySpy()
    findCatalogEntry('cylinder')!.create(context, { h: 5, mode: 'diameter', r: 1, d: 2, r1: 3, r2: 4, center: true, fn: 50 })
    expect(notifyDirty).not.toHaveBeenCalled()
  })

  it('Cube active semantic parameter edits notify dirty', () => {
    const { context, notifyDirty } = contextWithDirtySpy()
    const node = findCatalogEntry('cube')!.create(context, { size: { x: 10, y: 10, z: 10 }, center: false }) as CubeNode

    node.controls.sizeX!.setValue(99)
    expect(notifyDirty).toHaveBeenCalledTimes(1)

    node.controls.center!.setValue(true)
    expect(notifyDirty).toHaveBeenCalledTimes(2)
  })

  it('Cylinder active numeric parameter edits notify dirty', () => {
    const { context, notifyDirty } = contextWithDirtySpy()
    const node = findCatalogEntry('cylinder')!.create(context, { h: 10, mode: 'radius', r: 5, fn: 30 }) as CylinderNode

    node.controls.h.setValue(20)
    expect(notifyDirty).toHaveBeenCalledTimes(1)

    node.controls.r.setValue(42)
    expect(notifyDirty).toHaveBeenCalledTimes(2)
    node.controls.fn.setValue(50)
    expect(notifyDirty).toHaveBeenCalledTimes(3)
  })

  it('Sphere active parameter edits notify dirty', () => {
    const { context, notifyDirty } = contextWithDirtySpy()
    const node = findCatalogEntry('sphere')!.create(context, { mode: 'radius', r: 5, fn: 30 }) as import('./nodes/sphere-node').SphereNode

    node.controls.r!.setValue(12)
    expect(notifyDirty).toHaveBeenCalledTimes(1)

    node.controls.fn.setValue(50)
    expect(notifyDirty).toHaveBeenCalledTimes(2)
  })

  it('Translate: X change notifies dirty', () => {
    const { context, notifyDirty } = contextWithDirtySpy()
    const node = findCatalogEntry('translate')!.create(context) as import('./nodes/vector-transform-node').VectorTransformNode
    node.controls.x.setValue(10)
    expect(notifyDirty).toHaveBeenCalledTimes(1)
  })

  it('Rotate: Z change notifies dirty', () => {
    const { context, notifyDirty } = contextWithDirtySpy()
    const node = findCatalogEntry('rotate')!.create(context) as import('./nodes/vector-transform-node').VectorTransformNode
    node.controls.z.setValue(45)
    expect(notifyDirty).toHaveBeenCalledTimes(1)
  })

  it('Scale: a component change notifies dirty', () => {
    const { context, notifyDirty } = contextWithDirtySpy()
    const node = findCatalogEntry('scale')!.create(context) as import('./nodes/vector-transform-node').VectorTransformNode
    node.controls.y.setValue(0.5)
    expect(notifyDirty).toHaveBeenCalledTimes(1)
  })

  it('does not throw and does nothing when no notifyDirty is supplied (e.g. plain palette creation without dirty tracking)', () => {
    const node = findCatalogEntry('cube')!.create({ onControlsChanged: () => {} }, { size: { x: 1, y: 1, z: 1 } }) as CubeNode
    expect(() => node.controls.sizeX!.setValue(5)).not.toThrow()
  })
})

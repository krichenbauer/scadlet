import { NodeEditor } from 'rete'
import { describe, expect, it } from 'vitest'

import { findCatalogEntry, NODE_CATALOG, NODE_CATEGORIES } from './node-catalog'
import { CubeNode } from './nodes/cube-node'
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
})

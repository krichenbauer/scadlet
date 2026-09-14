import { describe, expect, it } from 'vitest'

import { GEOMETRY_RENDER_OPTIONS, type GeometryRenderOptions } from './render-options'
import { PreviewRenderCache, previewCacheKey } from './preview-cache'

const empty = { kind: 'empty' } as const
const stl = (bytes: number) => ({ kind: 'stl', stl: new ArrayBuffer(bytes) } as const)

describe('previewCacheKey', () => {
  it('includes the exact source and every output-affecting render option', () => {
    const otherOptions: GeometryRenderOptions = { ...GEOMETRY_RENDER_OPTIONS, exportFormat: 'binstl' }
    const changedOptions = { ...GEOMETRY_RENDER_OPTIONS, exportFormat: 'asciistl' } as unknown as GeometryRenderOptions
    expect(previewCacheKey('cube(1);', GEOMETRY_RENDER_OPTIONS)).toBe(previewCacheKey('cube(1);', otherOptions))
    expect(previewCacheKey('cube(1);', GEOMETRY_RENDER_OPTIONS)).not.toBe(previewCacheKey('cube(1);\n', otherOptions))
    expect(previewCacheKey('cube(1);', GEOMETRY_RENDER_OPTIONS)).not.toBe(previewCacheKey('cube(1);', changedOptions))
    expect(previewCacheKey('cube(1);', GEOMETRY_RENDER_OPTIONS)).toContain('Manifold')
    expect(previewCacheKey('cube(1);', GEOMETRY_RENDER_OPTIONS)).toContain('binstl')
  })
})

describe('PreviewRenderCache', () => {
  it('returns successful STL and empty preview results and promotes hits', () => {
    const cache = new PreviewRenderCache(2, 10_000)
    const cube = stl(8)
    cache.set('cube(1);', GEOMETRY_RENDER_OPTIONS, cube)
    cache.set('sphere(1);', GEOMETRY_RENDER_OPTIONS, empty)

    expect(cache.get('cube(1);', GEOMETRY_RENDER_OPTIONS)).toBe(cube)
    expect(cache.get('sphere(1);', GEOMETRY_RENDER_OPTIONS)).toBe(empty)
    expect(cache.get('cube(2);', GEOMETRY_RENDER_OPTIONS)).toBeUndefined()
  })

  it('evicts the least-recently-used entry at the entry limit', () => {
    const cache = new PreviewRenderCache(2, 10_000)
    cache.set('a', GEOMETRY_RENDER_OPTIONS, empty)
    cache.set('b', GEOMETRY_RENDER_OPTIONS, empty)
    expect(cache.get('a', GEOMETRY_RENDER_OPTIONS)).toBe(empty)
    cache.set('c', GEOMETRY_RENDER_OPTIONS, empty)

    expect(cache.get('a', GEOMETRY_RENDER_OPTIONS)).toBe(empty)
    expect(cache.get('b', GEOMETRY_RENDER_OPTIONS)).toBeUndefined()
    expect(cache.get('c', GEOMETRY_RENDER_OPTIONS)).toBe(empty)
  })

  it('bounds retained STL bytes and declines an individually oversized result', () => {
    const oneEntrySize = previewCacheKey('a', GEOMETRY_RENDER_OPTIONS).length * 2 + 20
    const cache = new PreviewRenderCache(8, oneEntrySize + 5)
    cache.set('a', GEOMETRY_RENDER_OPTIONS, stl(20))
    cache.set('b', GEOMETRY_RENDER_OPTIONS, stl(20))
    expect(cache.size).toBe(1)
    expect(cache.get('a', GEOMETRY_RENDER_OPTIONS)).toBeUndefined()
    expect(cache.get('b', GEOMETRY_RENDER_OPTIONS)).toBeDefined()
    expect(cache.totalBytes).toBeLessThanOrEqual(oneEntrySize + 5)

    cache.set('huge', GEOMETRY_RENDER_OPTIONS, stl(oneEntrySize + 6))
    expect(cache.get('huge', GEOMETRY_RENDER_OPTIONS)).toBeUndefined()
    expect(cache.size).toBe(1)
  })

  it('refreshes an existing key without growing the entry count', () => {
    const cache = new PreviewRenderCache(2, 10_000)
    const first = stl(4)
    const refreshed = stl(7)
    cache.set('cube(1);', GEOMETRY_RENDER_OPTIONS, first)
    cache.set('cube(1);', GEOMETRY_RENDER_OPTIONS, refreshed)
    expect(cache.size).toBe(1)
    expect(cache.get('cube(1);', GEOMETRY_RENDER_OPTIONS)).toBe(refreshed)
  })
})

import type { GeometryRenderResult } from './render-controller'
import type { GeometryRenderOptions } from './render-options'

export const DEFAULT_PREVIEW_CACHE_MAX_ENTRIES = 8
export const DEFAULT_PREVIEW_CACHE_MAX_BYTES = 64 * 1024 * 1024

interface CacheEntry {
  result: GeometryRenderResult
  sizeBytes: number
}

/** A collision-safe key over the exact source and every output-affecting
 * OpenSCAD option. The namespace makes later pipeline changes explicit. */
export function previewCacheKey(source: string, options: GeometryRenderOptions): string {
  return JSON.stringify(['scadlet-preview-v1', options.backend, options.exportFormat, source])
}

/** Session-local LRU for successful main-preview results. Admission remains
 * at the app boundary, after revision and Inspect-provenance checks pass. */
export class PreviewRenderCache {
  private readonly entries = new Map<string, CacheEntry>()
  private totalBytesValue = 0
  private readonly maxEntries: number
  private readonly maxBytes: number

  constructor(maxEntries = DEFAULT_PREVIEW_CACHE_MAX_ENTRIES, maxBytes = DEFAULT_PREVIEW_CACHE_MAX_BYTES) {
    if (!Number.isInteger(maxEntries) || maxEntries < 1) throw new Error('Preview cache maxEntries must be a positive integer.')
    if (!Number.isFinite(maxBytes) || maxBytes < 1) throw new Error('Preview cache maxBytes must be positive.')
    this.maxEntries = maxEntries
    this.maxBytes = maxBytes
  }

  get size(): number { return this.entries.size }
  get totalBytes(): number { return this.totalBytesValue }

  get(source: string, options: GeometryRenderOptions): GeometryRenderResult | undefined {
    const key = previewCacheKey(source, options)
    const entry = this.entries.get(key)
    if (!entry) return undefined
    // Map insertion order is the LRU order: promote every hit to newest.
    this.entries.delete(key)
    this.entries.set(key, entry)
    return entry.result
  }

  set(source: string, options: GeometryRenderOptions, result: GeometryRenderResult): void {
    const key = previewCacheKey(source, options)
    const existing = this.entries.get(key)
    if (existing) {
      this.entries.delete(key)
      this.totalBytesValue -= existing.sizeBytes
    }

    // Include the retained UTF-16 key in the bound as well as STL payload.
    const sizeBytes = key.length * 2 + (result.kind === 'stl' ? result.stl.byteLength : 0)
    if (sizeBytes > this.maxBytes) return

    this.entries.set(key, { result, sizeBytes })
    this.totalBytesValue += sizeBytes
    this.evictToLimits()
  }

  clear(): void {
    this.entries.clear()
    this.totalBytesValue = 0
  }

  private evictToLimits(): void {
    while (this.entries.size > this.maxEntries || this.totalBytesValue > this.maxBytes) {
      const oldest = this.entries.entries().next().value as [string, CacheEntry] | undefined
      if (!oldest) return
      this.entries.delete(oldest[0])
      this.totalBytesValue -= oldest[1].sizeBytes
    }
  }
}

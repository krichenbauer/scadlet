import { describe, expect, it } from 'vitest'

import viteConfig from './vite.config'

describe('vite optimizeDeps', () => {
  it('pre-bundles openscad-wasm-prebuilt so the dev server never discovers it late', () => {
    // Regression guard for the "first Render reloads the page" bug: this
    // dependency is only ever imported from `render-worker.ts`, a lazily
    // created `new Worker(new URL(...))` module that Vite's dependency
    // scanner doesn't crawl into. Without `optimizeDeps.include`, the dev
    // server discovers the dependency the first time the worker actually
    // runs (the first "Render" click), and force-reloads the page to
    // re-optimize, silently dropping any in-progress graph state.
    expect(viteConfig.optimizeDeps?.include).toContain('openscad-wasm-prebuilt')
  })
})

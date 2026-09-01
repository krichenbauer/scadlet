import { configDefaults, defineConfig } from 'vitest/config'

export default defineConfig({
  // GitHub Pages serves project sites below `/<repository>/`. The deployment
  // workflow supplies that prefix, while local development and other static
  // hosts continue to use the root path.
  base: process.env.BASE_PATH ?? '/',
  optimizeDeps: {
    // `openscad-wasm-prebuilt` is only ever imported from
    // `src/render/render-worker.ts`, which is loaded lazily as a
    // `new Worker(new URL(...))` module. Vite's dependency-optimizer scan
    // only crawls static imports reachable from index.html, so it never
    // sees this import ahead of time and instead discovers it the first
    // time the worker actually runs (i.e. the first "Render" click). That
    // late discovery makes the dev server re-optimize and forces a full
    // page reload to keep module identity consistent, silently dropping
    // any in-progress graph state. Listing it here makes Vite pre-bundle
    // it during the initial cold-start scan instead, so no optimizer
    // discovery/reload is ever triggered by a user action. This has no
    // effect on `vite build` (there is no dependency optimizer in a
    // production build).
    include: ['openscad-wasm-prebuilt'],
  },
  test: {
    // Unit tests are DOM-free (the IndexedDB suite injects
    // fake-indexeddb); real browser scenarios live under e2e/.
    environment: 'node',
    exclude: [...configDefaults.exclude, 'e2e/**'],
  },
})

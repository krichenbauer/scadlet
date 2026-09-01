import { createOpenSCAD } from 'openscad-wasm-prebuilt'

import type { RenderResponse, WorkerRequest } from './protocol'

/**
 * OpenSCAD execution worker (Milestone 2).
 *
 * OpenSCAD WASM integration: this uses the `openscad-wasm-prebuilt` npm
 * package, which ships a single self-contained ES module
 * (`openscad-wasm-prebuilt/dist/openscad.js`) with the OpenSCAD WASM
 * binary embedded directly inside it (base64-decoded at init time via a
 * custom `instantiateWasm` hook), rather than fetching a separate
 * `.wasm` file at runtime. That means:
 *   - no CDN or network fetch is required at runtime - the module is
 *     bundled by Vite like any other dependency, and this worker file is
 *     split into its own chunk so the ~11 MB payload only loads once a
 *     render is actually requested
 *   - no local build step (Docker/Emscripten/CMake) is required; the
 *     package is consumed as a prebuilt npm dependency
 * This was chosen over hand-vendoring build artifacts because it needs
 * no separate asset directory or manual update process, and it already
 * contains everything OpenSCAD needs for basic CSG rendering (no
 * additional font/MCAD assets are required for the primitives currently
 * implemented).
 *
 * A fresh OpenSCAD instance is created for every render. Reusing a
 * single instance's `callMain` across multiple renders was tried and
 * found to crash intermittently (OpenSCAD's `main()` does not reset all
 * of its internal/global state between invocations); creating a new
 * instance per render is simple, was verified stable across repeated
 * successes/failures, and costs roughly 60-180ms of extra init time,
 * which is acceptable for a manually triggered Render button. Re-verified
 * during the render-performance investigation (2026): reusing one
 * instance's `callMain` across a sequence of renders throws on every call
 * after the first, so this remains a hard requirement, not just an
 * intermittent flake.
 *
 * `callMain` is invoked with `--backend=Manifold` and
 * `--export-format=binstl`, both measured as strict improvements with no
 * observed correctness downside for the primitives/booleans this app
 * generates:
 *   - `--backend=Manifold` avoids OpenSCAD's default CGAL/Nef-polyhedron
 *     boolean backend, which was measured to scale disastrously with
 *     `$fn` for Union/Difference/Intersection (e.g. difference() of a
 *     cube and an $fn=50 sphere: ~3.4s with CGAL vs ~0.1s with Manifold;
 *     $fn=100: ~11.3s with CGAL vs ~0.2s with Manifold). For plain
 *     non-boolean geometry the two backends performed about the same.
 *   - `--export-format=binstl` avoids OpenSCAD's default ASCII STL
 *     export, which is markedly slower to generate and several times
 *     larger to transfer/parse than binary STL for the same geometry
 *     (e.g. an $fn=100 sphere: ~338ms/3.18MB ASCII vs ~129ms/0.5MB
 *     binary). `STLLoader` already auto-detects binary vs ASCII, so the
 *     viewer needs no changes.
 */

// Minimal structural view of the dedicated worker global scope, avoiding
// a dependency on the "webworker" lib (which conflicts with the "DOM"
// lib already used for the rest of the app in the same tsconfig).
interface WorkerScope {
  postMessage(message: RenderResponse, transfer?: Transferable[]): void
  onmessage: ((event: { data: unknown }) => void) | null
}

const scope = self as unknown as WorkerScope

function toErrorMessage(error: unknown, stderrLines: string[]): string {
  if (stderrLines.length > 0) return stderrLines.join('\n')
  if (error instanceof Error) return error.message
  return String(error)
}

async function render(source: string): Promise<RenderResponse> {
  const stderrLines: string[] = []
  const tStart = performance.now()

  try {
    const openscad = await createOpenSCAD({
      print: () => {
        /* discard stdout noise (geometry/cache stats) */
      },
      printErr: (text) => stderrLines.push(text),
    })
    const tWasmInit = performance.now()
    const instance = openscad.getInstance()

    instance.FS.writeFile('/input.scad', source)
    try {
      instance.callMain(['/input.scad', '--backend=Manifold', '--export-format=binstl', '-o', '/output.stl'])
      const tGeometry = performance.now()
      const bytes = instance.FS.readFile('/output.stl') as Uint8Array
      // Copy into a standalone, transferable ArrayBuffer - the FS-backed
      // view may reference a larger underlying heap buffer.
      const stl = bytes.slice().buffer
      const tRead = performance.now()
      console.log(
        `[render-worker] wasmInit=${(tWasmInit - tStart).toFixed(1)}ms ` +
          `geometry=${(tGeometry - tWasmInit).toFixed(1)}ms ` +
          `read=${(tRead - tGeometry).toFixed(1)}ms ` +
          `total=${(tRead - tStart).toFixed(1)}ms bytes=${stl.byteLength}`,
      )
      return { type: 'result', stl }
    } finally {
      try {
        instance.FS.unlink('/input.scad')
      } catch {
        /* nothing to clean up */
      }
      try {
        instance.FS.unlink('/output.stl')
      } catch {
        /* render failed before producing output */
      }
    }
  } catch (error) {
    return { type: 'error', message: toErrorMessage(error, stderrLines) }
  }
}

async function inspectValue(source: string): Promise<RenderResponse> {
  const output: string[] = []
  const errors: string[] = []
  try {
    const openscad = await createOpenSCAD({ print: (text) => output.push(text), printErr: (text) => errors.push(text) })
    const instance = openscad.getInstance()
    instance.FS.writeFile('/input.scad', source)
    try {
      // Supplying a CSG output target keeps OpenSCAD in command-line mode.
      // Calling it with only an input file requests its GUI mode in this WASM
      // build, which fails in a worker because no display exists.
      instance.callMain(['/input.scad', '-o', '/inspect.csg'])
    } finally {
      try { instance.FS.unlink('/input.scad') } catch { /* nothing to clean up */ }
      try { instance.FS.unlink('/inspect.csg') } catch { /* nothing to clean up */ }
    }
    const line = [...output, ...errors].find((text) => text.includes('__SCADLET_VALUE__:'))
    if (!line) return { type: 'error', message: errors.join('\n') || 'OpenSCAD did not return an inspected value.' }
    const marker = '__SCADLET_VALUE__:'
    const value = line.slice(line.indexOf(marker) + marker.length).replace(/^[\s",]+/, '').trim()
    return { type: 'value-result', value }
  } catch (error) {
    return { type: 'error', message: toErrorMessage(error, errors) }
  }
}

scope.onmessage = (event: { data: unknown }) => {
  const message = event.data as WorkerRequest
  if (message.type !== 'render' && message.type !== 'inspect-value') return

  void (message.type === 'render' ? render(message.source) : inspectValue(message.source)).then((response) => {
    if (response.type === 'result') {
      scope.postMessage(response, [response.stl])
    } else {
      scope.postMessage(response)
    }
  })
}

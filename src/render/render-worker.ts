import { createOpenSCAD } from 'openscad-wasm-prebuilt'

import type { RenderRequest, RenderResponse } from './protocol'

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
 * successes/failures, and costs roughly 100ms of extra init time, which
 * is acceptable for a manually triggered Render button.
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

  try {
    const openscad = await createOpenSCAD({
      print: () => {
        /* discard stdout noise (geometry/cache stats) */
      },
      printErr: (text) => stderrLines.push(text),
    })
    const instance = openscad.getInstance()

    instance.FS.writeFile('/input.scad', source)
    try {
      instance.callMain(['/input.scad', '-o', '/output.stl'])
      const bytes = instance.FS.readFile('/output.stl') as Uint8Array
      // Copy into a standalone, transferable ArrayBuffer - the FS-backed
      // view may reference a larger underlying heap buffer.
      const stl = bytes.slice().buffer
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

scope.onmessage = (event: { data: unknown }) => {
  const message = event.data as RenderRequest
  if (message.type !== 'render') return

  void render(message.source).then((response) => {
    if (response.type === 'result') {
      scope.postMessage(response, [response.stl])
    } else {
      scope.postMessage(response)
    }
  })
}

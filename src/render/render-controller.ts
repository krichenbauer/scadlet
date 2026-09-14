import { isRenderResponse, type RenderRequest, type WorkerRequest } from './protocol'
import { GEOMETRY_RENDER_OPTIONS, type GeometryRenderOptions } from './render-options'

export type GeometryRenderResult =
  | { kind: 'stl'; stl: ArrayBuffer }
  | { kind: 'empty' }

/**
 * The minimal subset of `Worker` that `RenderController` depends on, so
 * tests can inject a fake worker instead of spinning up a real one.
 */
export interface WorkerLike {
  postMessage(message: unknown, transfer?: Transferable[]): void
  terminate(): void
  onmessage: ((event: MessageEvent) => void) | null
  onerror: ((event: ErrorEvent) => void) | null
}

export type WorkerFactory = () => WorkerLike

export const AUTOMATIC_RENDER_TIMEOUT_MS = 15_000

export interface RenderExecutionOptions {
  renderOptions?: GeometryRenderOptions
  timeoutMs?: number
}

export class RenderTimeoutError extends Error {
  readonly timeoutMs: number

  constructor(timeoutMs: number) {
    super(`Automatic render exceeded its ${timeoutMs}ms time budget`)
    this.name = 'RenderTimeoutError'
    this.timeoutMs = timeoutMs
  }
}

function createRenderWorker(): WorkerLike {
  return new Worker(new URL('./render-worker.ts', import.meta.url), { type: 'module' })
}

/**
 * Owns the lifecycle of the OpenSCAD render worker and exposes a simple
 * one-render-at-a-time API: `render()` starts (or reuses) a worker and
 * resolves with STL bytes; `stop()` terminates the active worker so a
 * later `render()` call creates a fresh one. Deliberately does not queue,
 * debounce, or support concurrent renders (Milestone 2 scope).
 */
export class RenderController {
  private worker: WorkerLike | null = null
  private pending: {
    kind: 'render' | 'value'
    resolve: (result: GeometryRenderResult | string) => void
    reject: (error: Error) => void
    timeout?: ReturnType<typeof setTimeout>
  } | null = null
  private readonly createWorker: WorkerFactory
  /** `performance.now()` timestamp of the most recent `postMessage`, used only to log round-trip timing. */
  private renderStartedAt = 0

  constructor(createWorker: WorkerFactory = createRenderWorker) {
    this.createWorker = createWorker
  }

  get isRendering(): boolean {
    return this.pending !== null
  }

  render(source: string, execution: RenderExecutionOptions = {}): Promise<GeometryRenderResult> {
    if (this.pending) {
      return Promise.reject(new Error('A render is already in progress'))
    }

    return new Promise((resolve, reject) => {
      this.pending = { kind: 'render', resolve: (result) => resolve(result as GeometryRenderResult), reject }

      let worker: WorkerLike
      try {
        worker = this.worker ?? this.createWorker()
      } catch (error) {
        this.pending = null
        reject(error instanceof Error ? error : new Error(String(error)))
        return
      }
      this.worker = worker
      this.attachHandlers(worker)

      const request: RenderRequest = {
        type: 'render',
        source,
        options: execution.renderOptions ?? GEOMETRY_RENDER_OPTIONS,
      }
      this.renderStartedAt = performance.now()
      worker.postMessage(request)
      if (execution.timeoutMs !== undefined) {
        const timeoutMs = execution.timeoutMs
        const pending = this.pending
        pending.timeout = setTimeout(() => {
          if (this.pending !== pending) return
          if (this.worker === worker) {
            worker.terminate()
            this.worker = null
          }
          this.rejectPending(new RenderTimeoutError(timeoutMs))
        }, timeoutMs)
      }
    })
  }

  /** Evaluates an inspected value through OpenSCAD itself. The source must
   * contain an `echo()` expression; this never produces or replaces STL. */
  inspectValue(source: string): Promise<string> {
    if (this.pending) return Promise.reject(new Error('A render is already in progress'))
    return new Promise((resolve, reject) => {
      this.pending = { kind: 'value', resolve: (result) => resolve(result as string), reject }
      let worker: WorkerLike
      try { worker = this.worker ?? this.createWorker() } catch (error) {
        this.pending = null
        reject(error instanceof Error ? error : new Error(String(error)))
        return
      }
      this.worker = worker
      this.attachHandlers(worker)
      const request: WorkerRequest = { type: 'inspect-value', source }
      this.renderStartedAt = performance.now()
      worker.postMessage(request)
    })
  }

  /** Terminates the active worker (if any) and rejects any pending render. */
  stop(): void {
    this.worker?.terminate()
    this.worker = null
    this.rejectPending(new Error('Render stopped'))
  }

  destroy(): void {
    this.stop()
  }

  private attachHandlers(worker: WorkerLike): void {
    worker.onmessage = (event) => {
      // A terminated worker can still have a queued event in tests and some
      // browser implementations. It must never settle work owned by the
      // fresh worker created after Stop/supersession.
      if (this.worker !== worker) return
      const data = event.data
      if (!isRenderResponse(data)) {
        this.rejectPending(new Error('Received a malformed message from the render worker'))
        return
      }
      const pending = this.pending
      this.pending = null
      if (!pending) return
      if (pending.timeout !== undefined) clearTimeout(pending.timeout)
      if (data.type === 'result' && pending.kind === 'render') {
        console.log(`[render-controller] round-trip=${(performance.now() - this.renderStartedAt).toFixed(1)}ms`)
        pending.resolve({ kind: 'stl', stl: data.stl })
      } else if (data.type === 'empty-result' && pending.kind === 'render') {
        pending.resolve({ kind: 'empty' })
      } else if (data.type === 'value-result' && pending.kind === 'value') {
        pending.resolve(data.value)
      } else if (data.type === 'error') pending.reject(new Error(data.message))
      else pending.reject(new Error('Received an unexpected response from the render worker'))
    }

    worker.onerror = (event) => {
      if (this.worker !== worker) return
      this.worker?.terminate()
      this.worker = null
      this.rejectPending(new Error(event.message ?? 'The OpenSCAD render worker failed to initialize'))
    }
  }

  private rejectPending(error: Error): void {
    const pending = this.pending
    this.pending = null
    if (pending?.timeout !== undefined) clearTimeout(pending.timeout)
    pending?.reject(error)
  }
}

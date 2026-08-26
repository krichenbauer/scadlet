import { isRenderResponse, type RenderRequest } from './protocol'

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
  private pending: { resolve: (stl: ArrayBuffer) => void; reject: (error: Error) => void } | null = null
  private readonly createWorker: WorkerFactory
  /** `performance.now()` timestamp of the most recent `postMessage`, used only to log round-trip timing. */
  private renderStartedAt = 0

  constructor(createWorker: WorkerFactory = createRenderWorker) {
    this.createWorker = createWorker
  }

  get isRendering(): boolean {
    return this.pending !== null
  }

  render(source: string): Promise<ArrayBuffer> {
    if (this.pending) {
      return Promise.reject(new Error('A render is already in progress'))
    }

    return new Promise((resolve, reject) => {
      this.pending = { resolve, reject }

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

      const request: RenderRequest = { type: 'render', source }
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
      const data = event.data
      if (!isRenderResponse(data)) {
        this.rejectPending(new Error('Received a malformed message from the render worker'))
        return
      }
      const pending = this.pending
      this.pending = null
      if (!pending) return
      if (data.type === 'result') {
        console.log(`[render-controller] round-trip=${(performance.now() - this.renderStartedAt).toFixed(1)}ms`)
        pending.resolve(data.stl)
      } else pending.reject(new Error(data.message))
    }

    worker.onerror = (event) => {
      this.worker?.terminate()
      this.worker = null
      this.rejectPending(new Error(event.message ?? 'The OpenSCAD render worker failed to initialize'))
    }
  }

  private rejectPending(error: Error): void {
    const pending = this.pending
    this.pending = null
    pending?.reject(error)
  }
}

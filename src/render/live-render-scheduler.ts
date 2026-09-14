/**
 * Session-only policy for background preview renders.  It deliberately knows
 * nothing about Rete, OpenSCAD, or the viewer: the app supplies the one
 * existing render path when a quiet semantic revision becomes due.
 */
export interface LiveRenderSchedulerOptions {
  onDue(revision: number): void
  debounceMs?: number
  setTimeout?: (callback: () => void, delay: number) => ReturnType<typeof setTimeout>
  clearTimeout?: (timer: ReturnType<typeof setTimeout>) => void
}

export class LiveRenderScheduler {
  private readonly onDue: (revision: number) => void
  private readonly debounceMs: number
  private readonly scheduleTimeout: (callback: () => void, delay: number) => ReturnType<typeof setTimeout>
  private readonly cancelTimeout: (timer: ReturnType<typeof setTimeout>) => void
  private timer?: ReturnType<typeof setTimeout>
  private revisionValue = 0
  // A restored/new session has no preview result even though its semantic
  // revision starts at zero. This makes an off/on Live action correctly
  // recognize the current graph as stale.
  private successfulRevision = -1
  private stoppedRevision: number | null = null
  private liveValue = true

  constructor(options: LiveRenderSchedulerOptions) {
    this.onDue = options.onDue
    this.debounceMs = options.debounceMs ?? 400
    // Browser timer methods require their Window receiver; keep the native
    // call wrapped rather than storing an unbound method reference.
    this.scheduleTimeout = options.setTimeout ?? ((callback, delay) => setTimeout(callback, delay))
    this.cancelTimeout = options.clearTimeout ?? ((timer) => clearTimeout(timer))
  }

  get live(): boolean { return this.liveValue }
  get revision(): number { return this.revisionValue }
  get hasPendingRender(): boolean { return this.timer !== undefined }
  get isStale(): boolean { return this.successfulRevision !== this.revisionValue }

  /** Records the one class of graph changes that can alter generated source. */
  semanticChange(): number {
    this.revisionValue += 1
    this.stoppedRevision = null
    this.scheduleIfNeeded()
    return this.revisionValue
  }

  /** Inspect may replace the visible preview/source without changing graph
   * semantics. Mark the current main-graph result stale so leaving Inspect
   * can restore it through the same Live pipeline and revision guards. */
  invalidatePreviewForInspect(): void {
    if (!this.isStale) this.successfulRevision = this.revisionValue - 1
  }

  /** Resumes the ordinary debounced main-graph preview after Inspect ends.
   * Repeated callers still collapse to one timer through `scheduleIfNeeded`. */
  resumeAfterInspect(): void {
    this.scheduleIfNeeded()
  }

  setLive(live: boolean): void {
    if (this.liveValue === live) return
    this.liveValue = live
    if (!live) {
      this.cancelPending()
      return
    }
    // A deliberate off/on cycle is an explicit request to try the current
    // stale revision again, including one the user previously stopped.
    this.stoppedRevision = null
    this.renderImmediatelyIfStale()
  }

  /** Makes a restored project a distinct stale render target without
   * treating restoration as a semantic graph edit. */
  projectChanged(): number {
    this.cancelPending()
    this.revisionValue += 1
    this.successfulRevision = this.revisionValue - 1
    this.stoppedRevision = null
    return this.revisionValue
  }

  /** Explicit user actions (enabling Live/project activation) render now;
   * the 400ms delay is reserved for ordinary semantic edits. */
  renderImmediatelyIfStale(): void {
    this.cancelPending()
    if (!this.liveValue || !this.isStale || this.stoppedRevision === this.revisionValue) return
    this.onDue(this.revisionValue)
  }

  /** A toolbar render supersedes a delayed automatic request. */
  cancelPending(): void {
    if (this.timer === undefined) return
    this.cancelTimeout(this.timer)
    this.timer = undefined
  }

  destroy(): void {
    this.liveValue = false
    this.cancelPending()
  }

  /** Stop suppresses retries only for this exact unchanged graph revision. */
  stopCurrentRevision(): void {
    this.cancelPending()
    this.stoppedRevision = this.revisionValue
  }

  /** A normal or Live successful (including valid-empty) result is current. */
  markSuccessful(revision: number): void {
    if (revision === this.revisionValue) this.successfulRevision = revision
  }

  private scheduleIfNeeded(): void {
    this.cancelPending()
    if (!this.liveValue || !this.isStale || this.stoppedRevision === this.revisionValue) return
    const revision = this.revisionValue
    this.timer = this.scheduleTimeout(() => {
      this.timer = undefined
      if (!this.liveValue || revision !== this.revisionValue || this.stoppedRevision === revision || !this.isStale) return
      this.onDue(revision)
    }, this.debounceMs)
  }
}

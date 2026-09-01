import { RevisionConflictError, type StoredProject } from './local-project-store'
import type { ScadletProjectV1 } from './project'

export type AutosaveStatus = 'idle' | 'saving' | 'error' | 'conflict'

export interface AutosaveState {
  dirty: boolean
  status: AutosaveStatus
  message: string | null
}

export interface AutosaveControllerOptions {
  capture: () => ScadletProjectV1
  save: (project: ScadletProjectV1) => Promise<StoredProject>
  onPersisted?: (stored: StoredProject, isCurrentGeneration: boolean) => void
  onStateChange?: (state: AutosaveState) => void
  debounceMs?: number
  setTimer?: (callback: () => void, delay: number) => unknown
  clearTimer?: (handle: unknown) => void
}

/**
 * A deliberately small, single-flight autosave state machine. Changes
 * are generation-numbered so an older successful write can update the
 * expected storage revision but can never mark newer edits clean.
 */
export class AutosaveController {
  private readonly options: AutosaveControllerOptions
  private generation = 0
  private dirty = false
  private status: AutosaveStatus = 'idle'
  private message: string | null = null
  private timer?: unknown
  private inFlight?: Promise<boolean>
  private destroyed = false

  constructor(options: AutosaveControllerOptions) {
    this.options = options
  }

  get state(): AutosaveState {
    return { dirty: this.dirty, status: this.status, message: this.message }
  }

  markDirty(): void {
    if (this.destroyed) return
    this.generation += 1
    this.dirty = true
    if (this.status !== 'conflict') {
      this.status = 'idle'
      this.message = null
      this.schedule()
    }
    this.notify()
  }

  /** Prevents further writes after another tab announces a newer revision. */
  markConflict(message = 'This project was changed in another SCADlet tab. Your changes have not been overwritten.'): void {
    if (this.destroyed) return
    this.cancelTimer()
    this.status = 'conflict'
    this.message = message
    this.notify()
  }

  /** Used after loading/reloading or deliberately creating a conflict copy. */
  resetClean(): void {
    this.cancelTimer()
    this.generation += 1
    this.dirty = false
    this.status = 'idle'
    this.message = null
    this.notify()
  }

  /** Immediately persists every generation that exists when this call settles. */
  async flush(): Promise<boolean> {
    this.cancelTimer()
    if (this.isBlocked()) return false

    if (this.inFlight) await this.inFlight
    while (this.dirty && !this.isBlocked()) {
      const succeeded = await this.startSave()
      if (!succeeded) return false
    }
    return !this.dirty
  }

  destroy(): void {
    this.destroyed = true
    this.cancelTimer()
  }

  private schedule(): void {
    this.cancelTimer()
    const setTimer = this.options.setTimer ?? ((callback: () => void, delay: number) => setTimeout(callback, delay))
    this.timer = setTimer(() => {
      this.timer = undefined
      void this.flush()
    }, this.options.debounceMs ?? 750)
  }

  private cancelTimer(): void {
    if (this.timer === undefined) return
    const clearTimer =
      this.options.clearTimer ?? ((handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>))
    clearTimer(this.timer)
    this.timer = undefined
  }

  private startSave(): Promise<boolean> {
    if (this.inFlight) return this.inFlight
    const savingGeneration = this.generation
    let project: ScadletProjectV1
    try {
      project = this.options.capture()
    } catch (error) {
      this.fail(error)
      return Promise.resolve(false)
    }

    this.status = 'saving'
    this.message = null
    this.notify()
    this.inFlight = this.options
      .save(project)
      .then((stored) => {
        const isCurrentGeneration = savingGeneration === this.generation
        this.options.onPersisted?.(stored, isCurrentGeneration)
        if (isCurrentGeneration) {
          this.dirty = false
          this.status = 'idle'
          this.message = null
        } else {
          this.dirty = true
          this.status = 'idle'
        }
        this.notify()
        return true
      })
      .catch((error: unknown) => {
        if (error instanceof RevisionConflictError) {
          this.status = 'conflict'
          this.message = 'This project was changed in another SCADlet tab. Your changes have not been overwritten.'
        } else {
          this.fail(error)
        }
        this.dirty = true
        this.notify()
        return false
      })
      .finally(() => {
        this.inFlight = undefined
      })
    return this.inFlight
  }

  private fail(error: unknown): void {
    this.status = 'error'
    this.message = `Local autosave failed: ${error instanceof Error ? error.message : String(error)}`
    this.dirty = true
    this.notify()
  }

  private notify(): void {
    this.options.onStateChange?.(this.state)
  }

  private isBlocked(): boolean {
    return this.status === 'conflict' || this.status === 'error'
  }
}

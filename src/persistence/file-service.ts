import { parseScadletProjectText } from './validate'
import type { ScadletProjectV1 } from './project'

/** A minimal, structurally-typed subset of the real `FileSystemFileHandle` API this service actually uses - kept small and local rather than depending on `@types/wicg-file-system-access` for a couple of methods. */
export interface FileHandleLike {
  readonly name: string
  getFile(): Promise<{ text(): Promise<string> }>
  createWritable(): Promise<{ write(data: string): Promise<void>; close(): Promise<void> }>
}

/**
 * Capability boundary for the browser File System Access API
 * (`showOpenFilePicker`/`showSaveFilePicker`), so `ProjectFileService`
 * can be unit-tested against a fake implementation instead of requiring
 * a real picker/browser support (AGENTS.md persistence notes: progressive
 * enhancement, testable without real dialogs).
 */
export interface FileSystemCapability {
  readonly supported: boolean
  showOpenFilePicker(): Promise<FileHandleLike[]>
  showSaveFilePicker(suggestedName: string): Promise<FileHandleLike>
}

interface FileSystemAccessWindow {
  showOpenFilePicker?: (options?: unknown) => Promise<FileHandleLike[]>
  showSaveFilePicker?: (options?: unknown) => Promise<FileHandleLike>
}

const SCADLET_FILE_PICKER_TYPES = [
  { description: 'SCADlet project', accept: { 'application/json': ['.scadlet'] } },
]

/** The real, browser-backed `FileSystemCapability`, feature-detected at call time (not just once) so tests/SSR never need a real `window`. */
export function createBrowserFileSystemCapability(): FileSystemCapability {
  const getWindow = (): FileSystemAccessWindow => window as unknown as FileSystemAccessWindow

  return {
    get supported() {
      const w = getWindow()
      return typeof w.showOpenFilePicker === 'function' && typeof w.showSaveFilePicker === 'function'
    },
    async showOpenFilePicker() {
      const w = getWindow()
      return w.showOpenFilePicker!({ types: SCADLET_FILE_PICKER_TYPES })
    },
    async showSaveFilePicker(suggestedName) {
      const w = getWindow()
      return w.showSaveFilePicker!({ suggestedName, types: SCADLET_FILE_PICKER_TYPES })
    },
  }
}

/** True for the `DOMException`/`Error` a File System Access picker rejects with when the user cancels it. */
function isAbortError(error: unknown): boolean {
  if (typeof DOMException !== 'undefined' && error instanceof DOMException) return error.name === 'AbortError'
  return error instanceof Error && error.name === 'AbortError'
}

/** A picked fallback file (from a plain `<input type="file">`), independent of the File System Access API. */
export interface PickedFallbackFile {
  name: string
  text(): Promise<string>
}

export interface ProjectFileServiceDeps {
  capability: FileSystemCapability
  /** Fallback open: prompts the user to choose a file (e.g. a hidden `<input type="file">`). Resolves `null` if the user cancels (best-effort - see `pickFileWithInput`). */
  pickFileFallback: () => Promise<PickedFallbackFile | null>
  /** Fallback save: triggers a plain Blob download of `content` as `filename`. */
  downloadFallback: (content: string, filename: string) => void
}

/**
 * Open/Save/Save As for `.scadlet` project files, behind one small
 * injectable capability boundary (AGENTS.md: progressive enhancement,
 * File System Access where available, plain file input/Blob download
 * fallback otherwise - Firefox/Safari must still work). Retains the most
 * recently opened/saved `FileHandleLike` in memory only (never persisted
 * into `.scadlet` JSON or across reloads - that's an explicit future
 * IndexedDB-milestone decision, not this one).
 */
export class ProjectFileService {
  private handle: FileHandleLike | null = null
  private readonly deps: ProjectFileServiceDeps

  constructor(deps: ProjectFileServiceDeps) {
    this.deps = deps
  }

  /** The name of the currently held file handle, if any (e.g. for UI display), or `null` if nothing has been opened/saved via a real handle yet. */
  getHandleName(): string | null {
    return this.handle?.name ?? null
  }

  /** Forgets the current file handle, e.g. after starting a new project - the next `save()` will behave like `saveAs()`. */
  clearHandle(): void {
    this.handle = null
  }

  /**
   * Opens a `.scadlet` project. Returns `null` (without throwing, without
   * touching any existing project) if the user cancels a File System
   * Access picker. Parsing errors (`ScadletProjectError`) propagate to the
   * caller, which must not have mutated the current project yet either.
   */
  async open(): Promise<ScadletProjectV1 | null> {
    if (this.deps.capability.supported) {
      let handles: FileHandleLike[]
      try {
        handles = await this.deps.capability.showOpenFilePicker()
      } catch (error) {
        if (isAbortError(error)) return null
        throw error
      }
      const handle = handles[0]
      if (!handle) return null

      const file = await handle.getFile()
      const text = await file.text()
      const project = parseScadletProjectText(text)
      this.handle = handle
      return project
    }

    const picked = await this.deps.pickFileFallback()
    if (!picked) return null

    const text = await picked.text()
    const project = parseScadletProjectText(text)
    this.handle = null
    return project
  }

  /**
   * Always chooses/creates a destination where File System Access is
   * supported; otherwise downloads `project` as `suggestedName`. On
   * success (or on the fallback download path), the written/created
   * handle becomes the handle a later `save()` reuses. Returns `false`
   * (without writing anything) if the user cancels the save picker -
   * callers must treat that exactly like a no-op, e.g. not clearing
   * unsaved-changes state.
   */
  async saveAs(project: ScadletProjectV1, suggestedName: string): Promise<boolean> {
    const content = JSON.stringify(project, null, 2)

    if (this.deps.capability.supported) {
      let handle: FileHandleLike
      try {
        handle = await this.deps.capability.showSaveFilePicker(suggestedName)
      } catch (error) {
        if (isAbortError(error)) return false
        throw error
      }
      const writable = await handle.createWritable()
      await writable.write(content)
      await writable.close()
      this.handle = handle
      return true
    }

    this.deps.downloadFallback(content, suggestedName)
    this.handle = null
    return true
  }

  /**
   * Writes to the currently held file handle if one exists; otherwise
   * behaves exactly like `saveAs` (including the fallback-browser Blob
   * download, since there is no reusable handle there at all). Returns
   * `false` if (via the `saveAs` fallback path) the user cancels.
   */
  async save(project: ScadletProjectV1, suggestedName: string): Promise<boolean> {
    if (this.handle) {
      const content = JSON.stringify(project, null, 2)
      const writable = await this.handle.createWritable()
      await writable.write(content)
      await writable.close()
      return true
    }

    return this.saveAs(project, suggestedName)
  }
}

/**
 * Fallback file picker built on a temporary, invisible
 * `<input type="file">` - the standard cross-browser way to prompt for a
 * local file without File System Access support. Cancellation is not
 * reliably observable for this input across browsers, so unlike the File
 * System Access path (a real `AbortError`), a cancelled fallback pick
 * simply never resolves; nothing else happens, so this can't corrupt or
 * lose the current project - it just leaves Open pending.
 */
export function pickFileWithInput(): Promise<PickedFallbackFile | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.scadlet,application/json'
    input.style.display = 'none'

    input.addEventListener('change', () => {
      const file = input.files?.[0]
      document.body.removeChild(input)
      resolve(file ? { name: file.name, text: () => file.text() } : null)
    })

    document.body.appendChild(input)
    input.click()
  })
}

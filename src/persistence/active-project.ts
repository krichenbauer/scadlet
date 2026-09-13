import { CorruptLocalProjectError, type LocalProjectStore, type StoredProject } from './local-project-store'
import { createEmptyProject } from './project'

export const ACTIVE_PROJECT_SESSION_KEY = 'scadlet.activeProjectId'

export interface SessionStorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

/** The library itself is reachable, but a particular stored payload cannot
 * be read. Keeping this distinct from IndexedDB failures lets the UI offer
 * recovery instead of disabling all local projects. */
export class StartupProjectLoadError extends Error {
  readonly projectId: string

  constructor(projectId: string, cause: unknown) {
    super(`Could not load local project "${projectId}".`, { cause })
    this.name = 'StartupProjectLoadError'
    this.projectId = projectId
  }
}

/** The startup resolver keeps the ordinary stored project API while exposing
 * whether it opened existing local work or created the first empty project. */
export interface StartupProjectResolution {
  project: StoredProject
  restored: boolean
}

/** Tab-scoped active-project identity. Browser `sessionStorage` is deliberately used rather than shared `localStorage`. */
export class ActiveProjectSession {
  private readonly storage: SessionStorageLike
  private fallbackId: string | null = null

  constructor(storage: SessionStorageLike) {
    this.storage = storage
  }

  get(): string | null {
    try {
      return this.storage.getItem(ACTIVE_PROJECT_SESSION_KEY) ?? this.fallbackId
    } catch {
      return this.fallbackId
    }
  }

  set(projectId: string): void {
    this.fallbackId = projectId
    try {
      this.storage.setItem(ACTIVE_PROJECT_SESSION_KEY, projectId)
    } catch {
      // The local library remains usable for this page even when a
      // privacy policy disables sessionStorage; only reload affinity is
      // lost and startup falls back to the most-recent project.
    }
  }

  clear(): void {
    this.fallbackId = null
    try {
      this.storage.removeItem(ACTIVE_PROJECT_SESSION_KEY)
    } catch {
      // See set(): session storage is an affinity enhancement, not the
      // canonical project store.
    }
  }
}

export function createBrowserActiveProjectSession(): ActiveProjectSession {
  try {
    return new ActiveProjectSession(globalThis.sessionStorage)
  } catch {
    return new ActiveProjectSession({
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {},
    })
  }
}

/**
 * Deterministic startup policy: restore this tab's active project when
 * it exists; otherwise open the most recently updated local project;
 * create an empty project only when the library is empty.
 */
export async function resolveStartupProject(
  store: LocalProjectStore,
  session: ActiveProjectSession,
): Promise<StoredProject> {
  return (await resolveStartupProjectWithOrigin(store, session)).project
}

/**
 * Resolves the startup project together with its origin. Callers that need
 * bootstrap-only presentation behavior can distinguish a restored local
 * project from the empty record created for a brand-new library without
 * changing the stored-project lifecycle itself.
 */
export async function resolveStartupProjectWithOrigin(
  store: LocalProjectStore,
  session: ActiveProjectSession,
): Promise<StartupProjectResolution> {
  const activeId = session.get()
  if (activeId) {
    let active: StoredProject | null
    try {
      active = await store.getProject(activeId)
    } catch (error) {
      if (error instanceof CorruptLocalProjectError) throw new StartupProjectLoadError(activeId, error)
      throw error
    }
    if (active) return { project: active, restored: true }
    session.clear()
  }

  const projects = await store.listProjects()
  for (const mostRecent of projects) {
    let stored: StoredProject | null
    try {
      stored = await store.getProject(mostRecent.id)
    } catch (error) {
      // A non-active malformed record does not prevent a different valid
      // project from opening. IndexedDB access errors still propagate.
      if (error instanceof CorruptLocalProjectError) continue
      throw error
    }
    if (stored) {
      session.set(stored.id)
      return { project: stored, restored: true }
    }
  }

  const created = await store.createProject(createEmptyProject())
  session.set(created.id)
  return { project: created, restored: false }
}

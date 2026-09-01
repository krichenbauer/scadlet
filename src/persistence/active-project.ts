import type { LocalProjectStore, StoredProject } from './local-project-store'
import { createEmptyProject } from './project'

export const ACTIVE_PROJECT_SESSION_KEY = 'scadlet.activeProjectId'

export interface SessionStorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
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
  const activeId = session.get()
  if (activeId) {
    const active = await store.getProject(activeId)
    if (active) return active
    session.clear()
  }

  const [mostRecent] = await store.listProjects()
  if (mostRecent) {
    const stored = await store.getProject(mostRecent.id)
    if (stored) {
      session.set(stored.id)
      return stored
    }
  }

  const created = await store.createProject(createEmptyProject())
  session.set(created.id)
  return created
}

import { describe, expect, it, vi } from 'vitest'

import { ActiveProjectSession, resolveStartupProject, type SessionStorageLike } from './active-project'
import type { LocalProjectStore, StoredProject } from './local-project-store'
import { createEmptyProject } from './project'

class MemorySessionStorage implements SessionStorageLike {
  private readonly values = new Map<string, string>()
  getItem(key: string) { return this.values.get(key) ?? null }
  setItem(key: string, value: string) { this.values.set(key, value) }
  removeItem(key: string) { this.values.delete(key) }
}

function stored(id: string, name: string, revision = 1): StoredProject {
  const project = createEmptyProject(name, () => '2026-01-01T00:00:00.000Z')
  return { id, name, revision, createdAt: project.metadata.createdAt!, updatedAt: project.metadata.updatedAt!, project }
}

function fakeStore(projects: StoredProject[]): LocalProjectStore {
  return {
    listProjects: vi.fn(async () => projects.map(({ project: _project, ...summary }) => summary)),
    getProject: vi.fn(async (id) => projects.find((project) => project.id === id) ?? null),
    createProject: vi.fn(async (project) => {
      const created = { ...stored('new-id', project.metadata.name), project }
      projects.push(created)
      return created
    }),
    saveProject: vi.fn(),
    deleteProject: vi.fn(),
  }
}

describe('ActiveProjectSession', () => {
  it('sets, retrieves, and clears the tab-scoped active id', () => {
    const session = new ActiveProjectSession(new MemorySessionStorage())
    expect(session.get()).toBeNull()
    session.set('project-a')
    expect(session.get()).toBe('project-a')
    session.clear()
    expect(session.get()).toBeNull()
  })

  it('keeps an in-memory tab fallback when sessionStorage is unavailable', () => {
    const unavailable: SessionStorageLike = {
      getItem: () => { throw new Error('blocked') },
      setItem: () => { throw new Error('blocked') },
      removeItem: () => { throw new Error('blocked') },
    }
    const session = new ActiveProjectSession(unavailable)
    session.set('project-a')
    expect(session.get()).toBe('project-a')
    expect(() => session.clear()).not.toThrow()
    expect(session.get()).toBeNull()
  })
})

describe('resolveStartupProject', () => {
  it('restores an existing active project for this tab', async () => {
    const session = new ActiveProjectSession(new MemorySessionStorage())
    session.set('b')
    const store = fakeStore([stored('a', 'A'), stored('b', 'B')])
    await expect(resolveStartupProject(store, session)).resolves.toMatchObject({ id: 'b', name: 'B' })
  })

  it('clears a stale active id and falls back to the first (most-recent) summary', async () => {
    const session = new ActiveProjectSession(new MemorySessionStorage())
    session.set('missing')
    const store = fakeStore([stored('recent', 'Recent'), stored('older', 'Older')])
    const result = await resolveStartupProject(store, session)
    expect(result.id).toBe('recent')
    expect(session.get()).toBe('recent')
  })

  it('uses the most recent local project when this tab has no active id', async () => {
    const session = new ActiveProjectSession(new MemorySessionStorage())
    const result = await resolveStartupProject(fakeStore([stored('recent', 'Recent')]), session)
    expect(result.id).toBe('recent')
  })

  it('creates and activates a fresh empty project for an empty database', async () => {
    const session = new ActiveProjectSession(new MemorySessionStorage())
    const store = fakeStore([])
    const result = await resolveStartupProject(store, session)
    expect(result.id).toBe('new-id')
    expect(result.project.graph.nodes).toEqual([])
    expect(session.get()).toBe('new-id')
  })
})

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { IDBFactory } from 'fake-indexeddb'
import { NodeEditor } from 'rete'
import { DataflowEngine } from 'rete-engine'
import { describe, expect, it } from 'vitest'

import { evaluateOpenSCAD } from '../editor/evaluate'
import type { Schemes } from '../editor/schemes'
import {
  CorruptLocalProjectError,
  IndexedDBLocalProjectStore,
  LOCAL_PROJECT_DB_VERSION,
  RevisionConflictError,
} from './local-project-store'
import { createEmptyProject } from './project'
import { restoreProject } from './restore'
import { parseScadletProject } from './validate'

const EXAMPLES_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../docs/examples')

function fixture(filename: string) {
  return parseScadletProject(JSON.parse(readFileSync(join(EXAMPLES_DIR, filename), 'utf8')))
}

function storeWithFactory(options: { ids?: string[]; times?: string[]; name?: string } = {}) {
  const factory = new IDBFactory()
  const ids = options.ids ?? ['project-1', 'project-2', 'project-3']
  const times = options.times ?? [
    '2026-01-01T00:00:00.000Z',
    '2026-01-02T00:00:00.000Z',
    '2026-01-03T00:00:00.000Z',
  ]
  const databaseName = options.name ?? 'test-projects'
  return {
    factory,
    databaseName,
    store: new IndexedDBLocalProjectStore({
      indexedDB: factory,
      databaseName,
      createId: () => ids.shift() ?? crypto.randomUUID(),
      now: () => times.shift() ?? '2026-12-31T00:00:00.000Z',
    }),
  }
}

describe('IndexedDBLocalProjectStore', () => {
  it('initializes schema version 1 and an empty project store', async () => {
    const { factory, databaseName, store } = storeWithFactory()
    await expect(store.listProjects()).resolves.toEqual([])
    await store.close()

    const request = factory.open(databaseName)
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    expect(database.version).toBe(LOCAL_PROJECT_DB_VERSION)
    expect([...database.objectStoreNames]).toContain('projects')
    database.close()
  })

  it('creates, retrieves, lists, updates, increments revision, and deletes projects', async () => {
    const { store } = storeWithFactory({ ids: ['alpha', 'beta'] })
    const alpha = await store.createProject(createEmptyProject('Alpha'))
    const beta = await store.createProject(createEmptyProject('Beta'))

    expect(alpha.id).toBe('alpha')
    expect(beta.id).toBe('beta')
    expect(alpha.revision).toBe(1)
    expect((await store.getProject('alpha'))?.project.graph).toEqual({ nodes: [], connections: [] })
    expect(await store.getProject('missing')).toBeNull()

    const summaries = await store.listProjects()
    expect(summaries.map((summary) => summary.name)).toEqual(['Beta', 'Alpha'])
    expect(summaries[0]).toMatchObject({ id: 'beta', revision: 1, createdAt: expect.any(String), updatedAt: expect.any(String) })
    expect(summaries[0]).not.toHaveProperty('project')

    const changed = { ...alpha.project, metadata: { ...alpha.project.metadata, name: 'Alpha renamed' } }
    const saved = await store.saveProject(alpha.id, alpha.revision, changed)
    expect(saved.revision).toBe(2)
    expect(saved.name).toBe('Alpha renamed')
    expect((await store.getProject(alpha.id))?.project.metadata.name).toBe('Alpha renamed')

    await store.deleteProject(beta.id)
    expect(await store.getProject(beta.id)).toBeNull()
    expect((await store.listProjects()).map((summary) => summary.id)).toEqual(['alpha'])
  })

  it('uses unique generated local ids independently from project names', async () => {
    const { store } = storeWithFactory({ ids: ['id-a', 'id-b'] })
    const a = await store.createProject(createEmptyProject('Same name'))
    const b = await store.createProject(createEmptyProject('Same name'))
    expect(a.id).toBe('id-a')
    expect(b.id).toBe('id-b')
    expect((await store.listProjects()).map((project) => project.id).sort()).toEqual(['id-a', 'id-b'])
  })

  it.each([
    'empty-project.scadlet',
    'sphere-fn50.scadlet',
    'cube-sphere-union-translate.scadlet',
  ])('stores %s as the unchanged canonical payload apart from persistence timestamps', async (filename) => {
    const { store } = storeWithFactory()
    const project = fixture(filename)
    const stored = await store.createProject(project)
    const loaded = await store.getProject(stored.id)

    expect(loaded?.project.graph).toEqual(project.graph)
    expect(loaded?.project.editor).toEqual(project.editor)
    expect(loaded?.project.viewer).toEqual(project.viewer)

    const editor = new NodeEditor<Schemes>()
    const engine = new DataflowEngine<Schemes>((node) => ({
      inputs: () => Object.keys(node.inputs),
      outputs: () => Object.keys(node.outputs),
    }))
    editor.use(engine)
    await restoreProject(loaded!.project, {
      editor,
      creationContext: { onControlsChanged: () => {} },
      setNodePosition: () => {},
    })
    await expect(evaluateOpenSCAD(editor, engine)).resolves.toBeTypeOf('string')
  })

  it('atomically rejects a stale revision and retains both the winner and losing caller payload', async () => {
    const { store } = storeWithFactory()
    const original = await store.createProject(createEmptyProject('Original'))
    const clientA = await store.getProject(original.id)
    const clientB = await store.getProject(original.id)
    const aProject = { ...clientA!.project, metadata: { ...clientA!.project.metadata, name: 'From A' } }
    const bProject = { ...clientB!.project, metadata: { ...clientB!.project.metadata, name: 'From B' } }

    await store.saveProject(original.id, clientA!.revision, aProject)
    const conflict = await store.saveProject(original.id, clientB!.revision, bProject).catch((error) => error)

    expect(conflict).toBeInstanceOf(RevisionConflictError)
    expect(conflict.actualRevision).toBe(2)
    expect(conflict.attemptedProject.metadata.name).toBe('From B')
    expect((await store.getProject(original.id))?.project.metadata.name).toBe('From A')
    expect((await store.getProject(original.id))?.revision).toBe(2)
  })

  it('allows exactly one of two concurrent store instances to win the same expected revision', async () => {
    const { factory, databaseName, store: storeA } = storeWithFactory({ times: [
      '2026-01-01T00:00:00.000Z',
      '2026-01-02T00:00:00.000Z',
    ] })
    const storeB = new IndexedDBLocalProjectStore({
      indexedDB: factory,
      databaseName,
      now: () => '2026-01-03T00:00:00.000Z',
    })
    const original = await storeA.createProject(createEmptyProject('Original'))
    const fromA = { ...original.project, metadata: { ...original.project.metadata, name: 'Concurrent A' } }
    const fromB = { ...original.project, metadata: { ...original.project.metadata, name: 'Concurrent B' } }

    const results = await Promise.allSettled([
      storeA.saveProject(original.id, 1, fromA),
      storeB.saveProject(original.id, 1, fromB),
    ])

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    const rejected = results.find((result): result is PromiseRejectedResult => result.status === 'rejected')
    expect(rejected?.reason).toBeInstanceOf(RevisionConflictError)
    const final = await storeA.getProject(original.id)
    expect(final?.revision).toBe(2)
    expect(['Concurrent A', 'Concurrent B']).toContain(final?.name)
    await storeB.close()
  })

  it('reports a corrupt canonical payload instead of returning partially trusted state', async () => {
    const { factory, databaseName, store } = storeWithFactory()
    await store.listProjects()
    const request = factory.open(databaseName)
    const database = await new Promise<IDBDatabase>((resolve) => {
      request.onsuccess = () => resolve(request.result)
    })
    const transaction = database.transaction('projects', 'readwrite')
    transaction.objectStore('projects').put({
      id: 'broken',
      revision: 1,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      project: { format: 'scadlet', version: 999 },
    })
    await new Promise<void>((resolve) => {
      transaction.oncomplete = () => resolve()
    })
    database.close()

    await expect(store.getProject('broken')).rejects.toBeInstanceOf(CorruptLocalProjectError)
  })
})

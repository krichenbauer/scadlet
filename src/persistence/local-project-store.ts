import type { ScadletProjectV1 } from './project'
import { parseScadletProject } from './validate'

/** IndexedDB schema version. This is intentionally independent of the portable `.scadlet` format version. */
export const LOCAL_PROJECT_DB_VERSION = 1
export const LOCAL_PROJECT_DB_NAME = 'scadlet-projects'
const PROJECT_STORE_NAME = 'projects'

export interface ProjectSummary {
  id: string
  name: string
  revision: number
  createdAt: string
  updatedAt: string
}

export interface StoredProject extends ProjectSummary {
  project: ScadletProjectV1
}

export interface LocalProjectStore {
  listProjects(): Promise<ProjectSummary[]>
  getProject(id: string): Promise<StoredProject | null>
  createProject(project: ScadletProjectV1): Promise<StoredProject>
  saveProject(id: string, expectedRevision: number, project: ScadletProjectV1): Promise<StoredProject>
  deleteProject(id: string): Promise<void>
}

interface StoredProjectRecord {
  id: string
  revision: number
  createdAt: string
  updatedAt: string
  project: ScadletProjectV1
}

export class RevisionConflictError extends Error {
  readonly projectId: string
  readonly expectedRevision: number
  readonly actualRevision: number
  readonly attemptedProject: ScadletProjectV1

  constructor(
    projectId: string,
    expectedRevision: number,
    actualRevision: number,
    /** The caller's payload is retained so a conflict never discards the tab's unsaved work. */
    attemptedProject: ScadletProjectV1,
  ) {
    super(`Project "${projectId}" changed in another tab (expected revision ${expectedRevision}, found ${actualRevision}).`)
    this.name = 'RevisionConflictError'
    this.projectId = projectId
    this.expectedRevision = expectedRevision
    this.actualRevision = actualRevision
    this.attemptedProject = attemptedProject
  }
}

export class LocalProjectNotFoundError extends Error {
  readonly projectId: string

  constructor(projectId: string) {
    super(`Local project "${projectId}" no longer exists.`)
    this.name = 'LocalProjectNotFoundError'
    this.projectId = projectId
  }
}

export class CorruptLocalProjectError extends Error {
  readonly projectId: string

  constructor(projectId: string, cause: unknown) {
    super(`Local project "${projectId}" is corrupt or incompatible.`, { cause })
    this.name = 'CorruptLocalProjectError'
    this.projectId = projectId
  }
}

export interface IndexedDBLocalProjectStoreOptions {
  indexedDB?: IDBFactory
  databaseName?: string
  now?: () => string
  createId?: () => string
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.addEventListener('success', () => resolve(request.result), { once: true })
    request.addEventListener('error', () => reject(request.error ?? new Error('IndexedDB request failed.')), { once: true })
  })
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.addEventListener('complete', () => resolve(), { once: true })
    transaction.addEventListener(
      'abort',
      () => reject(transaction.error ?? new Error('IndexedDB transaction was aborted.')),
      { once: true },
    )
    transaction.addEventListener(
      'error',
      () => reject(transaction.error ?? new Error('IndexedDB transaction failed.')),
      { once: true },
    )
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function requireStoredRecord(value: unknown, knownId?: string): StoredProjectRecord {
  const id = knownId ?? (isRecord(value) && typeof value.id === 'string' ? value.id : 'unknown')
  if (
    !isRecord(value) ||
    typeof value.id !== 'string' ||
    !Number.isInteger(value.revision) ||
    (value.revision as number) < 1 ||
    typeof value.createdAt !== 'string' ||
    typeof value.updatedAt !== 'string'
  ) {
    throw new CorruptLocalProjectError(id, new Error('Invalid local-project record metadata.'))
  }

  try {
    return {
      id: value.id,
      revision: value.revision as number,
      createdAt: value.createdAt,
      updatedAt: value.updatedAt,
      project: parseScadletProject(value.project),
    }
  } catch (error) {
    if (error instanceof CorruptLocalProjectError) throw error
    throw new CorruptLocalProjectError(id, error)
  }
}

function asStoredProject(record: StoredProjectRecord): StoredProject {
  return {
    id: record.id,
    name: record.project.metadata.name,
    revision: record.revision,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    project: record.project,
  }
}

function withPersistenceTimestamp(
  project: ScadletProjectV1,
  updatedAt: string,
  fallbackCreatedAt: string = updatedAt,
): ScadletProjectV1 {
  return parseScadletProject({
    ...project,
    metadata: {
      ...project.metadata,
      createdAt: project.metadata.createdAt ?? fallbackCreatedAt,
      updatedAt,
    },
  })
}

/**
 * Native IndexedDB adapter for the local project library. The object
 * store wraps, but never reshapes, the same validated
 * `ScadletProjectV1` payload used by `.scadlet` files.
 */
export class IndexedDBLocalProjectStore implements LocalProjectStore {
  private readonly indexedDB: IDBFactory
  private readonly databaseName: string
  private readonly now: () => string
  private readonly createId: () => string
  private databasePromise?: Promise<IDBDatabase>

  constructor(options: IndexedDBLocalProjectStoreOptions = {}) {
    const factory = options.indexedDB ?? globalThis.indexedDB
    if (!factory) throw new Error('IndexedDB is not available in this browser.')
    this.indexedDB = factory
    this.databaseName = options.databaseName ?? LOCAL_PROJECT_DB_NAME
    this.now = options.now ?? (() => new Date().toISOString())
    this.createId = options.createId ?? (() => globalThis.crypto.randomUUID())
  }

  async listProjects(): Promise<ProjectSummary[]> {
    const database = await this.openDatabase()
    const transaction = database.transaction(PROJECT_STORE_NAME, 'readonly')
    const records = await requestResult(transaction.objectStore(PROJECT_STORE_NAME).getAll())
    await transactionDone(transaction)

    return records
      .map((record) => asStoredProject(requireStoredRecord(record)))
      .map(({ project: _project, ...summary }) => summary)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.name.localeCompare(b.name))
  }

  async getProject(id: string): Promise<StoredProject | null> {
    const database = await this.openDatabase()
    const transaction = database.transaction(PROJECT_STORE_NAME, 'readonly')
    const value = await requestResult(transaction.objectStore(PROJECT_STORE_NAME).get(id))
    await transactionDone(transaction)
    return value === undefined ? null : asStoredProject(requireStoredRecord(value, id))
  }

  async createProject(project: ScadletProjectV1): Promise<StoredProject> {
    const timestamp = this.now()
    const canonical = withPersistenceTimestamp(project, timestamp)
    const record: StoredProjectRecord = {
      id: this.createId(),
      revision: 1,
      createdAt: canonical.metadata.createdAt ?? timestamp,
      updatedAt: timestamp,
      project: canonical,
    }

    const database = await this.openDatabase()
    const transaction = database.transaction(PROJECT_STORE_NAME, 'readwrite')
    await requestResult(transaction.objectStore(PROJECT_STORE_NAME).add(record))
    await transactionDone(transaction)
    return asStoredProject(requireStoredRecord(record))
  }

  async saveProject(id: string, expectedRevision: number, project: ScadletProjectV1): Promise<StoredProject> {
    const canonicalAttempt = parseScadletProject(project)
    const database = await this.openDatabase()
    const transaction = database.transaction(PROJECT_STORE_NAME, 'readwrite')
    const done = transactionDone(transaction)
    const objectStore = transaction.objectStore(PROJECT_STORE_NAME)
    let rawExisting: unknown
    try {
      rawExisting = await requestResult(objectStore.get(id))
    } catch (error) {
      await done.catch(() => {})
      throw error
    }

    if (rawExisting === undefined) {
      transaction.abort()
      await done.catch(() => {})
      throw new LocalProjectNotFoundError(id)
    }

    let existing: StoredProjectRecord
    try {
      existing = requireStoredRecord(rawExisting, id)
    } catch (error) {
      transaction.abort()
      await done.catch(() => {})
      throw error
    }
    if (existing.revision !== expectedRevision) {
      transaction.abort()
      await done.catch(() => {})
      throw new RevisionConflictError(id, expectedRevision, existing.revision, canonicalAttempt)
    }

    const timestamp = this.now()
    const updated: StoredProjectRecord = {
      id,
      revision: existing.revision + 1,
      createdAt: existing.createdAt,
      updatedAt: timestamp,
      project: withPersistenceTimestamp(canonicalAttempt, timestamp, existing.createdAt),
    }
    try {
      await requestResult(objectStore.put(updated))
    } catch (error) {
      await done.catch(() => {})
      throw error
    }
    await done
    return asStoredProject(requireStoredRecord(updated))
  }

  async deleteProject(id: string): Promise<void> {
    const database = await this.openDatabase()
    const transaction = database.transaction(PROJECT_STORE_NAME, 'readwrite')
    await requestResult(transaction.objectStore(PROJECT_STORE_NAME).delete(id))
    await transactionDone(transaction)
  }

  /** Closes this adapter's connection; useful for deterministic tests and future database upgrades. */
  async close(): Promise<void> {
    const database = await this.databasePromise
    database?.close()
    this.databasePromise = undefined
  }

  private openDatabase(): Promise<IDBDatabase> {
    this.databasePromise ??= new Promise((resolve, reject) => {
      const request = this.indexedDB.open(this.databaseName, LOCAL_PROJECT_DB_VERSION)
      request.addEventListener(
        'upgradeneeded',
        () => {
          const database = request.result
          if (!database.objectStoreNames.contains(PROJECT_STORE_NAME)) {
            const store = database.createObjectStore(PROJECT_STORE_NAME, { keyPath: 'id' })
            store.createIndex('updatedAt', 'updatedAt')
          }
        },
        { once: true },
      )
      request.addEventListener('success', () => resolve(request.result), { once: true })
      request.addEventListener('error', () => reject(request.error ?? new Error('Could not open IndexedDB.')), {
        once: true,
      })
      request.addEventListener('blocked', () => reject(new Error('The local project database upgrade is blocked.')), {
        once: true,
      })
    })
    return this.databasePromise
  }
}

import { describe, expect, it, vi } from 'vitest'

import { AutosaveController } from './autosave'
import { RevisionConflictError, type StoredProject } from './local-project-store'
import { createEmptyProject, type ScadletProjectV1 } from './project'

function stored(project: ScadletProjectV1, revision = 2): StoredProject {
  return {
    id: 'p',
    name: project.metadata.name,
    revision,
    createdAt: project.metadata.createdAt!,
    updatedAt: project.metadata.updatedAt!,
    project,
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

describe('AutosaveController', () => {
  it('moves dirty -> saving -> clean after a durable save', async () => {
    const project = createEmptyProject('A')
    const save = vi.fn(async () => stored(project))
    const controller = new AutosaveController({ capture: () => project, save })
    controller.markDirty()
    expect(controller.state.dirty).toBe(true)
    await expect(controller.flush()).resolves.toBe(true)
    expect(controller.state).toEqual({ dirty: false, status: 'idle', message: null })
    expect(save).toHaveBeenCalledExactlyOnceWith(project)
    controller.destroy()
  })

  it('keeps the project dirty when storage fails', async () => {
    const controller = new AutosaveController({
      capture: () => createEmptyProject('A'),
      save: async () => { throw new Error('quota exceeded') },
    })
    controller.markDirty()
    await expect(controller.flush()).resolves.toBe(false)
    expect(controller.state.dirty).toBe(true)
    expect(controller.state.status).toBe('error')
    expect(controller.state.message).toContain('quota exceeded')
    controller.destroy()
  })

  it('keeps work dirty and enters conflict state on a stale revision', async () => {
    const project = createEmptyProject('B')
    const controller = new AutosaveController({
      capture: () => project,
      save: async () => { throw new RevisionConflictError('p', 1, 2, project) },
    })
    controller.markDirty()
    await expect(controller.flush()).resolves.toBe(false)
    expect(controller.state).toMatchObject({ dirty: true, status: 'conflict' })
    expect(controller.state.message).toContain('another SCADlet tab')
    controller.destroy()
  })

  it('never lets an older in-flight save mark a newer generation clean', async () => {
    let current = createEmptyProject('State A')
    const first = deferred<StoredProject>()
    const second = deferred<StoredProject>()
    const save = vi.fn()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise)
    const persisted: Array<{ name: string; current: boolean }> = []
    const controller = new AutosaveController({
      capture: () => current,
      save,
      onPersisted: (result, isCurrent) => persisted.push({ name: result.name, current: isCurrent }),
    })

    controller.markDirty()
    const flushing = controller.flush()
    current = createEmptyProject('State B')
    controller.markDirty()
    first.resolve(stored(createEmptyProject('State A'), 2))
    await first.promise
    await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(2))
    expect(controller.state.dirty).toBe(true)
    second.resolve(stored(createEmptyProject('State B'), 3))
    await expect(flushing).resolves.toBe(true)

    expect(persisted).toEqual([
      { name: 'State A', current: false },
      { name: 'State B', current: true },
    ])
    expect(controller.state.dirty).toBe(false)
    controller.destroy()
  })

  it('does not create an updatedAt autosave loop after onPersisted adopts the stored metadata', async () => {
    let metadata = createEmptyProject('A').metadata
    const save = vi.fn(async (project: ScadletProjectV1) => {
      const timestamped = { ...project, metadata: { ...project.metadata, updatedAt: '2026-06-01T00:00:00.000Z' } }
      return stored(timestamped)
    })
    const controller = new AutosaveController({
      capture: () => ({ ...createEmptyProject('A'), metadata }),
      save,
      onPersisted: (result) => { metadata = result.project.metadata },
    })
    controller.markDirty()
    await controller.flush()
    await Promise.resolve()
    expect(save).toHaveBeenCalledTimes(1)
    expect(controller.state.dirty).toBe(false)
    controller.destroy()
  })

  it('blocks writes immediately when a broadcast marks the active project stale', async () => {
    const save = vi.fn(async (project: ScadletProjectV1) => stored(project))
    const controller = new AutosaveController({ capture: () => createEmptyProject('A'), save })
    controller.markConflict()
    controller.markDirty()
    await expect(controller.flush()).resolves.toBe(false)
    expect(save).not.toHaveBeenCalled()
    expect(controller.state.status).toBe('conflict')
    controller.destroy()
  })
})


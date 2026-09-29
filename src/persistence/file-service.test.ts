import { describe, expect, it, vi } from 'vitest'

import { createEmptyProject } from './project'
import { ProjectFileService, type FileHandleLike, type FileSystemCapability, type PickedFallbackFile } from './file-service'

function fakeHandle(name: string, initialText = ''): FileHandleLike & { writtenContent: string[] } {
  const handle = {
    name,
    writtenContent: [] as string[],
    async getFile() {
      return { text: async () => initialText }
    },
    async createWritable() {
      return {
        write: async (data: string) => {
          handle.writtenContent.push(data)
        },
        close: async () => {},
      }
    },
  }
  return handle
}

function abortError(): DOMException {
  return new DOMException('The user aborted a request.', 'AbortError')
}

describe('ProjectFileService - File System Access available', () => {
  it('saveAs invokes the save picker with a suggested filename, writes content, and retains the handle', async () => {
    const handle = fakeHandle('My Project.scadlet')
    const showSaveFilePicker = vi.fn().mockResolvedValue(handle)
    const capability: FileSystemCapability = {
      supported: true,
      showOpenFilePicker: vi.fn(),
      showSaveFilePicker,
    }
    const service = new ProjectFileService({
      capability,
      pickFileFallback: vi.fn(),
      downloadFallback: vi.fn(),
    })

    const project = createEmptyProject('My Project')
    await expect(service.saveAs(project, 'My Project.scadlet')).resolves.toBe(true)

    expect(showSaveFilePicker).toHaveBeenCalledExactlyOnceWith('My Project.scadlet')
    expect(handle.writtenContent).toHaveLength(1)
    expect(JSON.parse(handle.writtenContent[0]).metadata.name).toBe('My Project')
    expect(service.getHandleName()).toBe('My Project.scadlet')
  })

  it('save with an existing handle writes to it without reopening the picker', async () => {
    const handle = fakeHandle('My Project.scadlet')
    const showSaveFilePicker = vi.fn().mockResolvedValue(handle)
    const capability: FileSystemCapability = {
      supported: true,
      showOpenFilePicker: vi.fn(),
      showSaveFilePicker,
    }
    const service = new ProjectFileService({ capability, pickFileFallback: vi.fn(), downloadFallback: vi.fn() })

    const project = createEmptyProject('My Project')
    await service.saveAs(project, 'My Project.scadlet')
    await expect(service.save(project, 'My Project.scadlet')).resolves.toBe(true)

    expect(showSaveFilePicker).toHaveBeenCalledTimes(1)
    expect(handle.writtenContent).toHaveLength(2)
  })

  it('save without a handle falls back to Save As behavior', async () => {
    const handle = fakeHandle('New.scadlet')
    const showSaveFilePicker = vi.fn().mockResolvedValue(handle)
    const capability: FileSystemCapability = {
      supported: true,
      showOpenFilePicker: vi.fn(),
      showSaveFilePicker,
    }
    const service = new ProjectFileService({ capability, pickFileFallback: vi.fn(), downloadFallback: vi.fn() })

    await expect(service.save(createEmptyProject('New'), 'New.scadlet')).resolves.toBe(true)

    expect(showSaveFilePicker).toHaveBeenCalledExactlyOnceWith('New.scadlet')
    expect(service.getHandleName()).toBe('New.scadlet')
  })

  it('open reads/parses the picked file and retains its handle', async () => {
    const text = JSON.stringify(createEmptyProject('Opened Project'))
    const handle = fakeHandle('Opened Project.scadlet', text)
    const showOpenFilePicker = vi.fn().mockResolvedValue([handle])
    const capability: FileSystemCapability = {
      supported: true,
      showOpenFilePicker,
      showSaveFilePicker: vi.fn(),
    }
    const service = new ProjectFileService({ capability, pickFileFallback: vi.fn(), downloadFallback: vi.fn() })

    const project = await service.open()

    expect(project?.metadata.name).toBe('Opened Project')
    expect(service.getHandleName()).toBe('Opened Project.scadlet')
  })

  it('cancelling the save picker (AbortError) resolves false, does not throw, and leaves no handle', async () => {
    const showSaveFilePicker = vi.fn().mockRejectedValue(abortError())
    const capability: FileSystemCapability = {
      supported: true,
      showOpenFilePicker: vi.fn(),
      showSaveFilePicker,
    }
    const service = new ProjectFileService({ capability, pickFileFallback: vi.fn(), downloadFallback: vi.fn() })

    await expect(service.saveAs(createEmptyProject(), 'X.scadlet')).resolves.toBe(false)
    expect(service.getHandleName()).toBeNull()
  })

  it('cancelling the open picker (AbortError) resolves null rather than throwing', async () => {
    const showOpenFilePicker = vi.fn().mockRejectedValue(abortError())
    const capability: FileSystemCapability = {
      supported: true,
      showOpenFilePicker,
      showSaveFilePicker: vi.fn(),
    }
    const service = new ProjectFileService({ capability, pickFileFallback: vi.fn(), downloadFallback: vi.fn() })

    await expect(service.open()).resolves.toBeNull()
  })

  it('a non-abort picker error propagates to the caller', async () => {
    const showSaveFilePicker = vi.fn().mockRejectedValue(new Error('disk full'))
    const capability: FileSystemCapability = {
      supported: true,
      showOpenFilePicker: vi.fn(),
      showSaveFilePicker,
    }
    const service = new ProjectFileService({ capability, pickFileFallback: vi.fn(), downloadFallback: vi.fn() })

    await expect(service.saveAs(createEmptyProject(), 'X.scadlet')).rejects.toThrow('disk full')
  })
})

describe('ProjectFileService - File System Access unavailable (fallback)', () => {
  function unsupportedCapability(): FileSystemCapability {
    return { supported: false, showOpenFilePicker: vi.fn(), showSaveFilePicker: vi.fn() }
  }

  it('saveAs downloads a Blob instead of using a picker', async () => {
    const downloadFallback = vi.fn()
    const service = new ProjectFileService({
      capability: unsupportedCapability(),
      pickFileFallback: vi.fn(),
      downloadFallback,
    })

    await service.saveAs(createEmptyProject('Fallback'), 'Fallback.scadlet')

    expect(downloadFallback).toHaveBeenCalledOnce()
    const [content, filename] = downloadFallback.mock.calls[0]
    expect(filename).toBe('Fallback.scadlet')
    expect(JSON.parse(content).metadata.name).toBe('Fallback')
    expect(service.getHandleName()).toBeNull()
  })

  it('save (no handle possible in fallback mode) also downloads a Blob', async () => {
    const downloadFallback = vi.fn()
    const service = new ProjectFileService({
      capability: unsupportedCapability(),
      pickFileFallback: vi.fn(),
      downloadFallback,
    })

    await service.save(createEmptyProject(), 'X.scadlet')

    expect(downloadFallback).toHaveBeenCalledOnce()
  })

  it('open reads text via the fallback file picker and uses the same parser', async () => {
    const text = JSON.stringify(createEmptyProject('Fallback Opened'))
    const picked: PickedFallbackFile = { name: 'Fallback Opened.scadlet', text: async () => text }
    const service = new ProjectFileService({
      capability: unsupportedCapability(),
      pickFileFallback: vi.fn().mockResolvedValue(picked),
      downloadFallback: vi.fn(),
    })

    const project = await service.open()

    expect(project?.metadata.name).toBe('Fallback Opened')
    expect(service.getHandleName()).toBeNull()
  })

  it('open resolves null and does nothing when the fallback picker resolves null (user cancelled)', async () => {
    const service = new ProjectFileService({
      capability: unsupportedCapability(),
      pickFileFallback: vi.fn().mockResolvedValue(null),
      downloadFallback: vi.fn(),
    })

    await expect(service.open()).resolves.toBeNull()
  })

  it('open surfaces a parse error for a malformed fallback file without crashing', async () => {
    const picked: PickedFallbackFile = { name: 'bad.scadlet', text: async () => '{not json' }
    const service = new ProjectFileService({
      capability: unsupportedCapability(),
      pickFileFallback: vi.fn().mockResolvedValue(picked),
      downloadFallback: vi.fn(),
    })

    await expect(service.open()).rejects.toThrow('not valid JSON')
  })
})

/** A project the loader refuses: its For Step is a literal zero. */
function zeroStepProject() {
  const project = createEmptyProject('Zero step')
  project.graph.nodes.push(
    { id: 'header', type: 'for', position: { x: 0, y: 0 }, parameters: { pairId: 'pair', bindingId: 'iterator', name: 'i', start: 0, step: 0, end: 3 } },
    { id: 'result', type: 'for-result', position: { x: 300, y: 0 }, parameters: { pairId: 'pair', children: [{ id: 'body' }] } },
  )
  project.graph.connections.push({ id: 'boundary', source: 'header', sourceOutput: 'loop', target: 'result', targetInput: 'loop' })
  return project
}

describe('ProjectFileService - refuses to write invalid projects', () => {
  it('saveAs throws the validation error before opening a picker or writing', async () => {
    const showSaveFilePicker = vi.fn()
    const service = new ProjectFileService({
      capability: { supported: true, showOpenFilePicker: vi.fn(), showSaveFilePicker },
      pickFileFallback: vi.fn(),
      downloadFallback: vi.fn(),
    })
    await expect(service.saveAs(zeroStepProject(), 'Zero step.scadlet')).rejects.toThrow('zero step')
    expect(showSaveFilePicker).not.toHaveBeenCalled()
  })

  it('save to an existing handle and the download fallback write nothing for an invalid project', async () => {
    const handle = fakeHandle('Zero step.scadlet')
    const service = new ProjectFileService({
      capability: { supported: true, showOpenFilePicker: vi.fn(), showSaveFilePicker: vi.fn().mockResolvedValue(handle) },
      pickFileFallback: vi.fn(),
      downloadFallback: vi.fn(),
    })
    await service.saveAs(createEmptyProject('Zero step'), 'Zero step.scadlet')
    handle.writtenContent.length = 0
    await expect(service.save(zeroStepProject(), 'Zero step.scadlet')).rejects.toThrow('zero step')
    expect(handle.writtenContent).toEqual([])

    const downloadFallback = vi.fn()
    const fallback = new ProjectFileService({
      capability: { supported: false, showOpenFilePicker: vi.fn(), showSaveFilePicker: vi.fn() },
      pickFileFallback: vi.fn(),
      downloadFallback,
    })
    await expect(fallback.saveAs(zeroStepProject(), 'Zero step.scadlet')).rejects.toThrow('zero step')
    expect(downloadFallback).not.toHaveBeenCalled()
  })
})

describe('ProjectFileService.clearHandle', () => {
  it('forces the next save to behave like saveAs again', async () => {
    const handle = fakeHandle('X.scadlet')
    const showSaveFilePicker = vi.fn().mockResolvedValue(handle)
    const capability: FileSystemCapability = { supported: true, showOpenFilePicker: vi.fn(), showSaveFilePicker }
    const service = new ProjectFileService({ capability, pickFileFallback: vi.fn(), downloadFallback: vi.fn() })

    await service.saveAs(createEmptyProject(), 'X.scadlet')
    service.clearHandle()
    await service.save(createEmptyProject(), 'X.scadlet')

    expect(showSaveFilePicker).toHaveBeenCalledTimes(2)
  })
})

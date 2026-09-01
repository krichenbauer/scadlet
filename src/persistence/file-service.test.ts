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
    await service.saveAs(project, 'My Project.scadlet')

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
    await service.save(project, 'My Project.scadlet')

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

    await service.save(createEmptyProject('New'), 'New.scadlet')

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

  it('cancelling the save picker (AbortError) does not throw and leaves no handle', async () => {
    const showSaveFilePicker = vi.fn().mockRejectedValue(abortError())
    const capability: FileSystemCapability = {
      supported: true,
      showOpenFilePicker: vi.fn(),
      showSaveFilePicker,
    }
    const service = new ProjectFileService({ capability, pickFileFallback: vi.fn(), downloadFallback: vi.fn() })

    await expect(service.saveAs(createEmptyProject(), 'X.scadlet')).resolves.toBeUndefined()
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

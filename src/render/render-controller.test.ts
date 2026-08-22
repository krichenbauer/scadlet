import { describe, expect, it, vi } from 'vitest'

import { RenderController, type WorkerLike } from './render-controller'

/** A fake `Worker` that records posted messages and lets tests drive responses. */
class FakeWorker implements WorkerLike {
  postMessage = vi.fn()
  terminate = vi.fn()
  onmessage: ((event: MessageEvent) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
}

/** Builds a minimal fake `MessageEvent` carrying `data`, for driving `worker.onmessage`. */
function messageEvent(data: unknown): MessageEvent {
  return { data } as MessageEvent
}

/** Builds a minimal fake `ErrorEvent` carrying `message`, for driving `worker.onerror`. */
function errorEvent(message: string): ErrorEvent {
  return { message } as ErrorEvent
}

describe('RenderController', () => {
  it('posts a render request and resolves with STL bytes on a result message', async () => {
    const worker = new FakeWorker()
    const controller = new RenderController(() => worker)

    const promise = controller.render('cube([1,1,1]);')
    expect(worker.postMessage).toHaveBeenCalledWith({ type: 'render', source: 'cube([1,1,1]);' })

    const stl = new ArrayBuffer(8)
    worker.onmessage?.(messageEvent({ type: 'result', stl }))

    await expect(promise).resolves.toBe(stl)
    expect(controller.isRendering).toBe(false)
  })

  it('rejects with the error message on an error response', async () => {
    const worker = new FakeWorker()
    const controller = new RenderController(() => worker)

    const promise = controller.render('bogus(')
    worker.onmessage?.(messageEvent({ type: 'error', message: 'syntax error' }))

    await expect(promise).rejects.toThrow('syntax error')
  })

  it('rejects a malformed message from the worker', async () => {
    const worker = new FakeWorker()
    const controller = new RenderController(() => worker)

    const promise = controller.render('cube([1,1,1]);')
    worker.onmessage?.(messageEvent({ unexpected: true }))

    await expect(promise).rejects.toThrow(/malformed/i)
  })

  it('rejects a concurrent render while one is already in progress', async () => {
    const worker = new FakeWorker()
    const controller = new RenderController(() => worker)

    void controller.render('cube([1,1,1]);')
    await expect(controller.render('sphere(5);')).rejects.toThrow(/already in progress/i)
    expect(worker.postMessage).toHaveBeenCalledTimes(1)
  })

  it('reuses the same worker across sequential renders', async () => {
    let created = 0
    const worker = new FakeWorker()
    const controller = new RenderController(() => {
      created += 1
      return worker
    })

    const first = controller.render('cube([1,1,1]);')
    worker.onmessage?.(messageEvent({ type: 'result', stl: new ArrayBuffer(1) }))
    await first

    const second = controller.render('sphere(5);')
    worker.onmessage?.(messageEvent({ type: 'result', stl: new ArrayBuffer(2) }))
    await second

    expect(created).toBe(1)
  })

  it('stop() terminates the worker and rejects the pending render', async () => {
    const worker = new FakeWorker()
    const controller = new RenderController(() => worker)

    const promise = controller.render('cube([1,1,1]);')
    controller.stop()

    await expect(promise).rejects.toThrow(/stopped/i)
    expect(worker.terminate).toHaveBeenCalledTimes(1)
    expect(controller.isRendering).toBe(false)
  })

  it('creates a fresh worker after stop() for a later render', async () => {
    let created = 0
    const workers = [new FakeWorker(), new FakeWorker()]
    const controller = new RenderController(() => workers[created++])

    controller.render('cube([1,1,1]);').catch(() => {})
    controller.stop()

    const promise = controller.render('sphere(5);')
    expect(created).toBe(2)
    workers[1].onmessage?.(messageEvent({ type: 'result', stl: new ArrayBuffer(1) }))
    await expect(promise).resolves.toBeInstanceOf(ArrayBuffer)
  })

  it('onerror terminates the worker and rejects the pending render', async () => {
    const worker = new FakeWorker()
    const controller = new RenderController(() => worker)

    const promise = controller.render('cube([1,1,1]);')
    worker.onerror?.(errorEvent('failed to fetch module'))

    await expect(promise).rejects.toThrow('failed to fetch module')
    expect(worker.terminate).toHaveBeenCalledTimes(1)
  })
})

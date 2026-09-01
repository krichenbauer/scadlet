import { describe, expect, it, vi } from 'vitest'

import { LocalProjectEvents, parseLocalProjectEvent } from './project-events'

class FakeBroadcastChannel {
  static instances: FakeBroadcastChannel[] = []
  readonly messages: unknown[] = []
  readonly name: string
  private listener?: (event: MessageEvent<unknown>) => void
  constructor(name: string) {
    this.name = name
    FakeBroadcastChannel.instances.push(this)
  }
  postMessage(message: unknown) { this.messages.push(message) }
  addEventListener(_type: 'message', listener: (event: MessageEvent<unknown>) => void) { this.listener = listener }
  removeEventListener() { this.listener = undefined }
  close() {}
  receive(data: unknown) { this.listener?.({ data } as MessageEvent<unknown>) }
}

describe('local project broadcast events', () => {
  it.each([
    { type: 'project-created', projectId: 'p', revision: 1 },
    { type: 'project-saved', projectId: 'p', revision: 2 },
    { type: 'project-deleted', projectId: 'p' },
  ])('validates $type event payloads', (event) => {
    expect(parseLocalProjectEvent(event)).toEqual(event)
  })

  it.each([null, {}, { type: 'project-saved', projectId: '', revision: 1 }, { type: 'project-saved', projectId: 'p' }])(
    'ignores malformed payload %#',
    (event) => expect(parseLocalProjectEvent(event)).toBeNull(),
  )

  it('publishes small metadata events and dispatches received events', () => {
    FakeBroadcastChannel.instances = []
    const events = new LocalProjectEvents(FakeBroadcastChannel)
    const listener = vi.fn()
    events.subscribe(listener)
    const channel = FakeBroadcastChannel.instances[0]

    events.publish({ type: 'project-created', projectId: 'a', revision: 1 })
    expect(channel.messages).toEqual([{ type: 'project-created', projectId: 'a', revision: 1 }])

    channel.receive({ type: 'project-saved', projectId: 'unrelated', revision: 2 })
    expect(listener).toHaveBeenCalledExactlyOnceWith({ type: 'project-saved', projectId: 'unrelated', revision: 2 })
    events.close()
  })

  it('degrades to a no-op when BroadcastChannel is unavailable', () => {
    const events = new LocalProjectEvents(null)
    expect(() => events.publish({ type: 'project-deleted', projectId: 'p' })).not.toThrow()
    events.close()
  })
})

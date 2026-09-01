export const LOCAL_PROJECT_CHANNEL_NAME = 'scadlet-local-projects'

export type LocalProjectEvent =
  | { type: 'project-created'; projectId: string; revision: number }
  | { type: 'project-saved'; projectId: string; revision: number }
  | { type: 'project-deleted'; projectId: string }

interface BroadcastChannelLike {
  postMessage(message: unknown): void
  addEventListener(type: 'message', listener: (event: MessageEvent<unknown>) => void): void
  removeEventListener(type: 'message', listener: (event: MessageEvent<unknown>) => void): void
  close(): void
}

type BroadcastChannelConstructor = new (name: string) => BroadcastChannelLike

export function parseLocalProjectEvent(value: unknown): LocalProjectEvent | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const event = value as Record<string, unknown>
  if (typeof event.projectId !== 'string' || event.projectId.length === 0) return null
  if (event.type === 'project-deleted') return { type: event.type, projectId: event.projectId }
  if (
    (event.type === 'project-created' || event.type === 'project-saved') &&
    Number.isInteger(event.revision) &&
    (event.revision as number) >= 1
  ) {
    return { type: event.type, projectId: event.projectId, revision: event.revision as number }
  }
  return null
}

/** Small BroadcastChannel wrapper. Events carry identity/revision only; IndexedDB remains the source of truth. */
export class LocalProjectEvents {
  private readonly channel: BroadcastChannelLike | null
  private readonly listeners = new Set<(event: LocalProjectEvent) => void>()
  private readonly onMessage = (message: MessageEvent<unknown>): void => {
    const event = parseLocalProjectEvent(message.data)
    if (!event) return
    for (const listener of this.listeners) listener(event)
  }

  constructor(Channel: BroadcastChannelConstructor | null | undefined = globalThis.BroadcastChannel) {
    this.channel = Channel ? new Channel(LOCAL_PROJECT_CHANNEL_NAME) : null
    this.channel?.addEventListener('message', this.onMessage)
  }

  publish(event: LocalProjectEvent): void {
    this.channel?.postMessage(event)
  }

  subscribe(listener: (event: LocalProjectEvent) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  close(): void {
    this.channel?.removeEventListener('message', this.onMessage)
    this.channel?.close()
    this.listeners.clear()
  }
}

import type { SocketType } from './sockets'

export interface ConnectionGestureOrigin {
  nodeId: string
  socketKey: string
  side: 'input' | 'output'
  socketType: SocketType
}

export interface ActiveConnectionGesture {
  origin: ConnectionGestureOrigin
  candidateNodeId: string | null
  snapTarget: ConnectionSnapTarget | null
}

export interface ConnectionSnapTarget {
  nodeId: string
  socketKey: string
  side: 'input' | 'output'
}

export interface SnapCandidate extends ConnectionSnapTarget {
  socketType: SocketType
  x: number
  y: number
  canConnect: boolean
}

/** Physical target radius in CSS pixels. Using client-space positions keeps
 * the interaction forgiving and consistent while the canvas zooms. */
export const CONNECTION_SNAP_RADIUS_PX = 28

export function nearestSnapTarget(
  origin: ConnectionGestureOrigin,
  candidates: readonly SnapCandidate[],
  pointer: { x: number; y: number },
  radius = CONNECTION_SNAP_RADIUS_PX,
): ConnectionSnapTarget | null {
  const opposite = origin.side === 'output' ? 'input' : 'output'
  return candidates
    .filter((candidate) => candidate.side === opposite && candidate.socketType === origin.socketType && candidate.canConnect)
    .map((candidate) => ({ candidate, distance: Math.hypot(candidate.x - pointer.x, candidate.y - pointer.y) }))
    .filter(({ distance }) => distance <= radius)
    .sort((a, b) => a.distance - b.distance || a.candidate.nodeId.localeCompare(b.candidate.nodeId) || a.candidate.socketKey.localeCompare(b.candidate.socketKey))[0]
    ?.candidate ?? null
}

type GestureListener = (previous: ActiveConnectionGesture | null, current: ActiveConnectionGesture | null) => void

interface SocketPort {
  socket?: { name?: string }
}

/** Returns the currently existing ports compatible with a connection type.
 * It deliberately only examines active Rete ports: disclosure never creates
 * an optional parameter or switches a node's representation. */
export function compatiblePortKeys(
  ports: Record<string, SocketPort | undefined>,
  socketType: SocketType,
): string[] {
  return Object.entries(ports)
    .filter(([, port]) => port?.socket?.name === socketType)
    .map(([key]) => key)
}

/**
 * Presentation-only lifecycle for a connection the user is currently
 * creating. Rete remains the authority for the real connection; this small
 * state only lets compact nodes reliably disclose relevant existing ports.
 */
export class ConnectionGestureManager {
  private current: ActiveConnectionGesture | null = null
  private readonly listeners = new Set<GestureListener>()

  get active(): Readonly<ActiveConnectionGesture> | null {
    return this.current
  }

  subscribe(listener: GestureListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  begin(origin: ConnectionGestureOrigin): void {
    this.set({ origin, candidateNodeId: null, snapTarget: null })
  }

  setCandidate(nodeId: string | null): void {
    if (!this.current || this.current.candidateNodeId === nodeId) return
    this.set({ ...this.current, candidateNodeId: nodeId, snapTarget: nodeId === this.current.candidateNodeId ? this.current.snapTarget : null })
  }

  setSnapTarget(target: ConnectionSnapTarget | null): void {
    if (!this.current) return
    const current = this.current.snapTarget
    if (current?.nodeId === target?.nodeId && current?.socketKey === target?.socketKey && current?.side === target?.side) return
    this.set({ ...this.current, snapTarget: target })
  }

  complete(): void {
    this.set(null)
  }

  cancel(): void {
    this.set(null)
  }

  /** A removed source invalidates the whole gesture; a removed candidate
   * simply leaves the still-active wire without a hovered target. */
  removeNode(nodeId: string): void {
    if (!this.current) return
    if (this.current.origin.nodeId === nodeId) {
      this.cancel()
    } else if (this.current.candidateNodeId === nodeId) {
      this.setCandidate(null)
    }
  }

  reset(): void {
    this.cancel()
  }

  private set(next: ActiveConnectionGesture | null): void {
    const previous = this.current
    this.current = next
    for (const listener of this.listeners) listener(previous, next)
  }
}

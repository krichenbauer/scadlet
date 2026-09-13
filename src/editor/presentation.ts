export interface NodePresentationManagerOptions {
  /** Re-render just the affected node after a presentation change. */
  onChange(nodeId: string): void
}

interface InternalState {
  /** Explicit, persisted compact state. New nodes intentionally start open. */
  collapsed: boolean
  /** Connected rows remain visible while compact so their real Rete sockets
   * keep stable, usable connection anchors. */
  connectedInputKeys: Set<string>
}

/**
 * Owns node-only presentation state outside Rete's semantic graph. Unlike
 * the former hover/pin model, a node changes size only through its explicit
 * collapse button. Pointer movement and connection gestures have no path into
 * this state, so they cannot expand a node or reveal hidden parameter rows.
 */
export class NodePresentationManager {
  private readonly states = new Map<string, InternalState>()
  private readonly onChange: (nodeId: string) => void

  constructor(options: NodePresentationManagerOptions) {
    this.onChange = options.onChange
  }

  private stateFor(nodeId: string): InternalState {
    let state = this.states.get(nodeId)
    if (!state) {
      state = { collapsed: false, connectedInputKeys: new Set() }
      this.states.set(nodeId, state)
    }
    return state
  }

  isCollapsed(nodeId: string): boolean {
    return this.stateFor(nodeId).collapsed
  }

  isExpanded(nodeId: string): boolean {
    return !this.isCollapsed(nodeId)
  }

  /** Used by the renderer for the complete normal control body. */
  isInteractivelyExpanded(nodeId: string): boolean {
    return this.isExpanded(nodeId)
  }

  setCollapsed(nodeId: string, collapsed: boolean): void {
    const state = this.stateFor(nodeId)
    if (state.collapsed === collapsed) return
    state.collapsed = collapsed
    this.onChange(nodeId)
  }

  toggleCollapsed(nodeId: string): void {
    this.setCollapsed(nodeId, !this.isCollapsed(nodeId))
  }

  setConnectedInputs(nodeId: string, keys: ReadonlySet<string>): void {
    const state = this.stateFor(nodeId)
    const changed = state.connectedInputKeys.size !== keys.size || [...keys].some((key) => !state.connectedInputKeys.has(key))
    if (!changed) return
    state.connectedInputKeys = new Set(keys)
    this.onChange(nodeId)
  }

  getConnectedInputKeys(nodeId: string): ReadonlySet<string> {
    return this.stateFor(nodeId).connectedInputKeys
  }

  remove(nodeId: string): void {
    this.states.delete(nodeId)
  }
}

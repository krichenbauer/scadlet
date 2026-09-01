import { supportsHover } from './hover'

export interface NodePresentationManagerOptions {
  /** Called whenever a node's effective presentation changes and it needs to be re-rendered (e.g. `area.update('node', id)`). */
  onChange(nodeId: string): void
  /** Overridable for tests; defaults to a real `matchMedia` check (see `hover.ts`). */
  hoverCapable?: () => boolean
  /** Delay before a collapsed, hovered, unpinned node auto-expands. AGENTS.md suggests ~500-800ms. */
  expandDelayMs?: number
  /** Delay before an expanded, unpinned node auto-collapses once the pointer leaves. AGENTS.md suggests ~500-1000ms. */
  collapseDelayMs?: number
}

const DEFAULT_EXPAND_DELAY_MS = 650
const DEFAULT_COLLAPSE_DELAY_MS = 800

interface InternalState {
  expanded: boolean
  pinned: boolean
  hovered: boolean
  focused: boolean
  /** Last `node.selected` value observed via `syncSelection`, used to detect actual transitions rather than re-triggering on every render. */
  lastSelected: boolean
  /** Set of parameter input keys (non-geometry) that have active connections, recomputed from Rete connections by the editor. */
  connectedInputKeys: Set<string>
  /** Temporary compatible parameter rows revealed while a wire is over this node. */
  disclosedInputKeys: Set<string>
}

/**
 * Owns every node's presentation state (collapsed / temporarily expanded /
 * pinned expanded) entirely outside Rete's own graph model. Per AGENTS.md
 * this must never touch node parameters, connections, node identity, or
 * graph evaluation - it only tracks, per node id, whether the node's
 * control body should currently be rendered (see `render.ts`).
 *
 * "Temporarily expanded" and "pinned expanded" are represented as two
 * independent booleans (`expanded`, `pinned`) rather than a 3-way enum:
 * `isExpanded()` is simply `pinned || expanded`, and `togglePin` always
 * forces `expanded` to match the new `pinned` value - so callers never
 * have to reconcile a pinned-but-collapsed or contradictory combination.
 *
 * Hover (desktop) and selection (touch/no-hover) are deliberately
 * mutually exclusive triggers gated by `hoverCapable()`, per AGENTS.md
 * section 5 ("the same presentation model is shared between mouse and
 * touch; only the trigger differs") - a hover-capable device never reacts
 * to `handleSelected`/`handleDeselected`, and a non-hover device never
 * schedules hover timers.
 */
export class NodePresentationManager {
  private readonly states = new Map<string, InternalState>()
  private readonly expandTimers = new Map<string, ReturnType<typeof setTimeout>>()
  private readonly collapseTimers = new Map<string, ReturnType<typeof setTimeout>>()
  private readonly hoverCapable: () => boolean
  private readonly onChange: (nodeId: string) => void
  private readonly expandDelayMs: number
  private readonly collapseDelayMs: number

  constructor(options: NodePresentationManagerOptions) {
    this.onChange = options.onChange
    this.hoverCapable = options.hoverCapable ?? supportsHover
    this.expandDelayMs = options.expandDelayMs ?? DEFAULT_EXPAND_DELAY_MS
    this.collapseDelayMs = options.collapseDelayMs ?? DEFAULT_COLLAPSE_DELAY_MS
  }

  private stateFor(nodeId: string): InternalState {
    let state = this.states.get(nodeId)
    if (!state) {
      // New nodes start collapsed, per AGENTS.md section 2.
      state = { expanded: false, pinned: false, hovered: false, focused: false, lastSelected: false, connectedInputKeys: new Set(), disclosedInputKeys: new Set() }
      this.states.set(nodeId, state)
    }
    return state
  }

  private clearExpandTimer(nodeId: string): void {
    const timer = this.expandTimers.get(nodeId)
    if (timer !== undefined) {
      clearTimeout(timer)
      this.expandTimers.delete(nodeId)
    }
  }

  private clearCollapseTimer(nodeId: string): void {
    const timer = this.collapseTimers.get(nodeId)
    if (timer !== undefined) {
      clearTimeout(timer)
      this.collapseTimers.delete(nodeId)
    }
  }

  isExpanded(nodeId: string): boolean {
    const state = this.stateFor(nodeId)
    return state.pinned || state.expanded || state.connectedInputKeys.size > 0
  }

  /** True only when the node is expanded via hover or explicit pin - not due to connected parameter inputs.
   * Used by the renderer to decide whether to show ALL rows vs only connected rows. */
  isInteractivelyExpanded(nodeId: string): boolean {
    const state = this.stateFor(nodeId)
    return state.pinned || state.expanded
  }

  isPinned(nodeId: string): boolean {
    return this.stateFor(nodeId).pinned
  }

  /** Updates the set of parameter input keys (non-geometry sockets) that have active connections;
   * recomputed by the editor on every connection change. A node with any connected parameter input
   * stays at least partially expanded so the connection endpoints remain visible. */
  setConnectedInputs(nodeId: string, keys: ReadonlySet<string>): void {
    const state = this.stateFor(nodeId)
    const changed = state.connectedInputKeys.size !== keys.size ||
      [...keys].some((k) => !state.connectedInputKeys.has(k))
    if (!changed) return
    state.connectedInputKeys = new Set(keys)
    this.onChange(nodeId)
  }

  /** The parameter input keys that currently have active connections (used by the renderer to decide which rows stay visible when collapsed). */
  getConnectedInputKeys(nodeId: string): ReadonlySet<string> {
    return this.stateFor(nodeId).connectedInputKeys
  }

  getDisclosedInputKeys(nodeId: string): ReadonlySet<string> {
    return this.stateFor(nodeId).disclosedInputKeys
  }

  /** Shows only compatible existing parameter rows while a connection wire
   * hovers the node. This is ephemeral UI state: it never adds parameters
   * or changes the graph. */
  setConnectionDisclosure(nodeId: string, keys: ReadonlySet<string>): void {
    const state = this.stateFor(nodeId)
    const changed = state.disclosedInputKeys.size !== keys.size || [...keys].some((key) => !state.disclosedInputKeys.has(key))
    if (!changed) return
    state.disclosedInputKeys = new Set(keys)
    this.onChange(nodeId)
  }

  /**
   * Desktop/hover trigger: schedules an auto-expand after `expandDelayMs`
   * of continuous hover. A no-op without real hover capability (touch uses
   * `handleSelected` instead), while pinned, or while already expanded.
   */
  handlePointerEnter(nodeId: string): void {
    if (!this.hoverCapable()) return
    this.stateFor(nodeId).hovered = true
    // Re-entering cancels any pending auto-collapse from a previous leave.
    this.clearCollapseTimer(nodeId)

    const state = this.stateFor(nodeId)
    if (state.pinned || state.expanded) return

    this.clearExpandTimer(nodeId)
    const timer = setTimeout(() => {
      this.expandTimers.delete(nodeId)
      const current = this.stateFor(nodeId)
      if (current.pinned || current.expanded) return
      current.expanded = true
      this.onChange(nodeId)
    }, this.expandDelayMs)
    this.expandTimers.set(nodeId, timer)
  }

  /**
   * Desktop/hover trigger: cancels any pending auto-expand and, if the
   * node is currently (temporarily) expanded, schedules an auto-collapse
   * after `collapseDelayMs`. The delay (rather than an instant collapse)
   * absorbs brief pointer fly-bys without the node flickering open/closed.
   */
  handlePointerLeave(nodeId: string): void {
    if (!this.hoverCapable()) return
    this.stateFor(nodeId).hovered = false
    this.clearExpandTimer(nodeId)

    const state = this.stateFor(nodeId)
    if (state.pinned || !state.expanded) return

    this.clearCollapseTimer(nodeId)
    const timer = setTimeout(() => {
      this.collapseTimers.delete(nodeId)
      const current = this.stateFor(nodeId)
      if (current.pinned || current.focused || !current.expanded) return
      current.expanded = false
      this.onChange(nodeId)
    }, this.collapseDelayMs)
    this.collapseTimers.set(nodeId, timer)
  }

  /** Focus is a temporary expansion trigger so controls cannot disappear
   * while being edited. Node-level focus containment is handled by the
   * renderer, keeping this manager DOM-free. */
  handleFocusEnter(nodeId: string): void {
    const state = this.stateFor(nodeId)
    state.focused = true
    this.clearCollapseTimer(nodeId)
  }

  handleFocusLeave(nodeId: string): void {
    const state = this.stateFor(nodeId)
    state.focused = false
    if (!state.hovered) this.handlePointerLeave(nodeId)
  }

  /**
   * Touch/no-hover trigger: selecting a collapsed node expands it
   * immediately (selection is already an explicit gesture, so no delay is
   * needed). Guarded to hover-incapable devices only - see class docs.
   */
  handleSelected(nodeId: string): void {
    if (this.hoverCapable()) return
    this.clearExpandTimer(nodeId)
    this.clearCollapseTimer(nodeId)

    const state = this.stateFor(nodeId)
    if (state.expanded) return
    state.expanded = true
    this.onChange(nodeId)
  }

  /** Touch/no-hover trigger: deselecting (e.g. tapping elsewhere) collapses an unpinned, expanded node immediately. */
  handleDeselected(nodeId: string): void {
    if (this.hoverCapable()) return
    const state = this.stateFor(nodeId)
    if (state.pinned || !state.expanded) return

    this.clearExpandTimer(nodeId)
    this.clearCollapseTimer(nodeId)
    state.expanded = false
    this.onChange(nodeId)
  }

  /**
   * Feeds the renderer's observed `node.selected` flag (Rete's own
   * selection state, set by `AreaExtensions.selectableNodes` - see
   * `editor.ts`) into `handleSelected`/`handleDeselected`, reusing the
   * existing selection mechanism per AGENTS.md section 5 instead of
   * inventing a parallel touch-only state. Only acts on an actual
   * transition, and defers the call to a microtask so it never runs
   * re-entrantly inside the `render.ts` call stack that observed it
   * (`onChange` above can itself trigger a nested render pass).
   */
  syncSelection(nodeId: string, selected: boolean): void {
    const state = this.stateFor(nodeId)
    if (state.lastSelected === selected) return
    state.lastSelected = selected
    queueMicrotask(() => {
      if (selected) this.handleSelected(nodeId)
      else this.handleDeselected(nodeId)
    })
  }

  /**
   * Toggles pinning. Single, deliberately chosen behavior (AGENTS.md
   * section 7): pinning always also expands; unpinning always also
   * collapses immediately. This lets one header button (see `render.ts`)
   * serve as both the "pin" control (section 6) and the "manual
   * expand/collapse" affordance (section 7) without a second control.
   */
  togglePin(nodeId: string): void {
    this.clearExpandTimer(nodeId)
    this.clearCollapseTimer(nodeId)

    const state = this.stateFor(nodeId)
    state.pinned = !state.pinned
    state.expanded = state.pinned
    this.onChange(nodeId)
  }

  /** Clears all timers/state for a removed node so no stale timer can ever update it again. */
  remove(nodeId: string): void {
    this.clearExpandTimer(nodeId)
    this.clearCollapseTimer(nodeId)
    this.states.delete(nodeId)
  }
}

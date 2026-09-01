export interface InspectManagerOptions {
  /** Called whenever a node's inspected state changes and it needs to be re-rendered (e.g. `area.update('node', id)`). */
  onChange(nodeId: string): void
  /** Max gap in ms between two pointerdowns on the same node to count as a double-click. Overridable for tests. */
  doubleClickThresholdMs?: number
  /** Injectable clock, overridable for tests instead of real `Date.now()`. */
  now?: () => number
}

/**
 * Owns the "Inspect Node" feature's single piece of state - which node
 * (if any) is currently the temporary preview root - entirely outside
 * Rete's own graph model, the same architectural pattern
 * `NodePresentationManager` uses for collapsed/expanded/pinned state.
 *
 * This is presentation/editor state only: it never touches node data,
 * connections, or node identity beyond storing an id, and it holds at
 * most one inspected node at a time. `evaluate.ts`'s `evaluateOpenSCAD`
 * is what actually gives the id meaning (as an alternate evaluation
 * root) - this class only tracks which id that is and notifies callers
 * when it changes so the affected node(s) can be re-rendered.
 */
export class InspectManager {
  private inspectedId: string | null = null
  private valueResult: string | null = null
  private readonly onChange: (nodeId: string) => void
  private readonly doubleClickThresholdMs: number
  private readonly now: () => number
  private lastPointerDown: { nodeId: string; time: number } | null = null

  constructor(options: InspectManagerOptions) {
    this.onChange = options.onChange
    this.doubleClickThresholdMs = options.doubleClickThresholdMs ?? 400
    this.now = options.now ?? (() => Date.now())
  }

  /** The currently inspected node id, or `null` if inspection is inactive. */
  get id(): string | null {
    return this.inspectedId
  }

  isInspected(nodeId: string): boolean {
    return this.inspectedId === nodeId
  }

  getValueResult(nodeId: string): string | null {
    return this.inspectedId === nodeId ? this.valueResult : null
  }

  setValueResult(nodeId: string, value: string): void {
    if (this.inspectedId !== nodeId) return
    this.valueResult = value
    this.onChange(nodeId)
  }

  /**
   * Double-click toggle behavior: inspecting the already-inspected node
   * clears inspection (back to normal full-graph rendering); inspecting
   * any other node replaces the previous inspect root with it. Notifies
   * `onChange` for every node whose rendered state actually changed (the
   * previous inspect root, if any, and the new one), so callers can
   * re-render just those - never the whole graph.
   */
  toggle(nodeId: string): void {
    const previous = this.inspectedId
    if (previous === nodeId) {
      this.inspectedId = null
      this.valueResult = null
      this.onChange(nodeId)
      return
    }

    this.inspectedId = nodeId
    this.valueResult = null
    if (previous !== null) this.onChange(previous)
    this.onChange(nodeId)
  }

  /**
   * Clears inspection if `nodeId` was the inspected node - called when a
   * node is removed from the graph, so a deleted node's id can never be
   * retained as a stale inspect root (AGENTS.md-adjacent requirement:
   * presentation state must never outlive the node it describes).
   */
  remove(nodeId: string): void {
    if (this.inspectedId !== nodeId) return
    this.inspectedId = null
    this.valueResult = null
    this.onChange(nodeId)
  }

  /**
   * Registers a `pointerdown` on `nodeId` as one half of a possible
   * double-click, toggling inspection if it's the second pointerdown on
   * the SAME node within `doubleClickThresholdMs`.
   *
   * Native `dblclick` is deliberately not used to detect this gesture on
   * a node. Rete's own built-in `AreaExtensions.simpleNodesOrder` moves a
   * node's DOM element (`content.reorder`, effectively `appendChild`) on
   * every `nodepicked` signal, which fires synchronously from the same
   * `pointerdown` that starts a click. That DOM mutation, happening
   * between `mousedown` and the later `mouseup`, causes Chromium to
   * silently never synthesize the `click`/`dblclick` event for that
   * gesture at all (confirmed empirically: `pointerdown`/`mousedown`/
   * `pointerup`/`mouseup` all fire on a node, but `click`/`dblclick`
   * never do). Node selection sidesteps this same problem by also being
   * driven directly from `pointerdown` (`nodepicked`) rather than a
   * native `click` - this method applies the identical strategy to
   * double-click detection instead of depending on a browser event that
   * never reaches a node.
   */
  registerPointerDown(nodeId: string): void {
    const time = this.now()
    const previous = this.lastPointerDown
    this.lastPointerDown = { nodeId, time }

    if (previous && previous.nodeId === nodeId && time - previous.time <= this.doubleClickThresholdMs) {
      this.lastPointerDown = null
      this.toggle(nodeId)
    }
  }
}

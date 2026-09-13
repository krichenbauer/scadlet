export interface InspectManagerOptions {
  /** Called whenever a node's inspected state changes and it needs to be re-rendered (e.g. `area.update('node', id)`). */
  onChange(nodeId: string): void
  onScopeChange?: () => void
  /** Max gap in ms between two pointerdowns on the same node to count as a double-click. Overridable for tests. */
  doubleClickThresholdMs?: number
  /** Injectable clock, overridable for tests instead of real `Date.now()`. */
  now?: () => number
}

/**
 * Owns the "Inspect Node" feature's single piece of state - which node
 * (if any) produced the currently displayed Inspect result - entirely outside
 * Rete's own graph model, the same architectural pattern
 * `NodePresentationManager` uses for collapsed/expanded/pinned state.
 *
 * This is presentation/editor state only: it never touches node data,
 * connections, or node identity beyond storing an id, and it holds at
 * most one inspected node at a time. `evaluate.ts` gives an attempted node id
 * meaning; the application commits that attempt here only after its
 * OpenSCAD-backed result replaces the displayed result. This prevents a
 * failed or superseded attempt from becoming stale decoration.
 */
export class InspectManager {
  private inspectedId: string | null = null
  private valueResult: string | null = null
  private readonly onChange: (nodeId: string) => void
  private readonly onScopeChange: () => void
  private readonly doubleClickThresholdMs: number
  private readonly now: () => number
  private lastPointerDown: { nodeId: string; time: number } | null = null
  private participatingIds = new Set<string>()

  constructor(options: InspectManagerOptions) {
    this.onChange = options.onChange
    this.onScopeChange = options.onScopeChange ?? (() => {})
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

  activate(nodeId: string, participatingIds: ReadonlySet<string>): void {
    const previous = this.inspectedId
    this.inspectedId = nodeId
    this.valueResult = null
    this.participatingIds = new Set(participatingIds)
    if (previous !== null && previous !== nodeId) this.onChange(previous)
    this.onChange(nodeId)
    this.onScopeChange()
  }

  participates(nodeId: string): boolean {
    return this.inspectedId !== null && this.participatingIds.has(nodeId)
  }

  /** Commits a successful Geometry Inspect after its STL replaced the viewer preview. */
  commitGeometry(nodeId: string): void {
    this.commit(nodeId, null)
  }

  /** Commits a successful Value Inspect and its displayed OpenSCAD result. */
  commitValue(nodeId: string, value: string): void {
    this.commit(nodeId, value)
  }

  /** Clears the provenance of the current Inspect result. The last valid
   * Geometry mesh may remain visible, but is no longer claimed as Inspect. */
  clear(): void {
    const previous = this.inspectedId
    if (previous === null) return
    this.inspectedId = null
    this.valueResult = null
    this.participatingIds.clear()
    this.onChange(previous)
    this.onScopeChange()
  }

  private commit(nodeId: string, value: string | null): void {
    const previous = this.inspectedId
    this.inspectedId = nodeId
    this.valueResult = value
    if (previous !== null && previous !== nodeId) this.onChange(previous)
    this.onChange(nodeId)
    this.onScopeChange()
  }

  /**
   * Clears inspection if `nodeId` was the inspected node - called when a
   * node is removed from the graph, so a deleted node's id can never be
   * retained as a stale inspect root (AGENTS.md-adjacent requirement:
   * presentation state must never outlive the node it describes).
   */
  remove(nodeId: string): void {
    if (this.inspectedId !== nodeId) return
    this.clear()
  }

  /**
   * Registers a `pointerdown` on `nodeId` as one half of a possible
   * double-click, returning whether it is the second pointerdown on the SAME
   * node within `doubleClickThresholdMs`. The caller commits only a successful
   * one-shot evaluation separately.
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
  registerPointerDown(nodeId: string): boolean {
    const time = this.now()
    const previous = this.lastPointerDown
    this.lastPointerDown = { nodeId, time }

    if (previous && previous.nodeId === nodeId && time - previous.time <= this.doubleClickThresholdMs) {
      this.lastPointerDown = null
      return true
    }
    return false
  }
}

/** Transient single-wire selection. It intentionally stores only a Rete
 * connection id: graph semantics, persistence, and dirty tracking remain
 * entirely in the editor. */
export class ConnectionSelectionManager {
  private selectedId: string | null = null
  private readonly listeners = new Set<(previous: string | null, current: string | null) => void>()

  get id(): string | null { return this.selectedId }
  isSelected(id: string): boolean { return this.selectedId === id }

  subscribe(listener: (previous: string | null, current: string | null) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  select(id: string): void { this.set(id) }
  clear(): void { this.set(null) }
  remove(id: string): void { if (this.selectedId === id) this.clear() }

  private set(next: string | null): void {
    if (next === this.selectedId) return
    const previous = this.selectedId
    this.selectedId = next
    for (const listener of this.listeners) listener(previous, next)
  }
}

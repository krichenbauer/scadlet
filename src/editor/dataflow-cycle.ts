/** The structural information needed to reason about one graph scope without
 * depending on Rete, persistence DTOs, or definition-call dependencies. */
export interface DataflowEdge {
  source: string
  target: string
}

/**
 * Returns whether adding `candidate` would make a directed node-dataflow
 * cycle. The caller supplies edges from exactly one semantic graph scope;
 * definition Calls are just nodes here, so their referenced definitions are
 * deliberately never traversed.
 */
export function wouldCreateDataflowCycle(
  edges: readonly DataflowEdge[],
  candidate: DataflowEdge,
): boolean {
  if (candidate.source === candidate.target) return true

  // A new source → target edge closes a cycle precisely when target already
  // reaches source. This covers dead/disconnected subgraphs as well as roots
  // that are reachable by code generation.
  const outgoing = new Map<string, string[]>()
  for (const edge of edges) {
    const targets = outgoing.get(edge.source)
    if (targets) targets.push(edge.target)
    else outgoing.set(edge.source, [edge.target])
  }

  const pending = [candidate.target]
  const visited = new Set<string>()
  while (pending.length > 0) {
    const nodeId = pending.pop()!
    if (nodeId === candidate.source) return true
    if (visited.has(nodeId)) continue
    visited.add(nodeId)
    pending.push(...(outgoing.get(nodeId) ?? []))
  }
  return false
}

/** Finds a connection which proves a persisted graph has cyclic node
 * dataflow. Connections are checked in their stored order only to provide a
 * useful error location; cycle validity itself is order-independent. */
export function firstDataflowCycle<Edge extends DataflowEdge>(edges: readonly Edge[]): Edge | undefined {
  const accepted: Edge[] = []
  for (const edge of edges) {
    if (wouldCreateDataflowCycle(accepted, edge)) return edge
    accepted.push(edge)
  }
  return undefined
}

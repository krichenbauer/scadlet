/** Minimal, implementation-independent view of project definitions used to
 * derive Function dependencies from the expression that can actually reach
 * each Function Output. Persistence validation and the live Rete editor both
 * adapt their own graph representation to this shape. */
export interface FunctionDependencyDefinition {
  id: string
  kind: 'module' | 'function'
  outputNodeId: string
}

export interface FunctionDependencyNode {
  id: string
  scope: string | null
  calledFunctionId?: string
}

export interface FunctionDependencyConnection {
  source: string
  target: string
}

export interface FunctionDependencyAnalysis {
  dependencies: ReadonlyMap<string, ReadonlySet<string>>
  /** Stable callee-before-caller order, preserving project order between
   * otherwise independent Functions. Empty when `cycle` is present. */
  order: readonly string[]
  /** A closed path such as `[A, B, A]`. */
  cycle?: readonly string[]
}

export function analyzeFunctionDependencies(
  definitions: readonly FunctionDependencyDefinition[],
  nodes: readonly FunctionDependencyNode[],
  connections: readonly FunctionDependencyConnection[],
): FunctionDependencyAnalysis {
  const functions = definitions.filter((definition) => definition.kind === 'function')
  const functionIds = new Set(functions.map((definition) => definition.id))
  const nodeById = new Map(nodes.map((node) => [node.id, node]))
  const incoming = new Map<string, string[]>()
  for (const connection of connections) {
    const sources = incoming.get(connection.target) ?? []
    sources.push(connection.source)
    incoming.set(connection.target, sources)
  }

  const dependencies = new Map<string, ReadonlySet<string>>()
  for (const definition of functions) {
    const found = new Set<string>()
    const visited = new Set<string>()
    const pending = [definition.outputNodeId]
    while (pending.length > 0) {
      const target = pending.pop()!
      for (const source of incoming.get(target) ?? []) {
        if (visited.has(source)) continue
        visited.add(source)
        const node = nodeById.get(source)
        // Scope is checked explicitly even though normal graph validation
        // already forbids cross-scope wires. This keeps hypothetical live
        // transfer analysis honest before a proposed scope edit commits.
        if (!node || node.scope !== definition.id) continue
        if (node.calledFunctionId && functionIds.has(node.calledFunctionId)) found.add(node.calledFunctionId)
        pending.push(source)
      }
    }
    dependencies.set(definition.id, found)
  }

  const visiting = new Set<string>()
  const visited = new Set<string>()
  const stack: string[] = []
  const order: string[] = []
  let cycle: string[] | undefined
  const visit = (id: string): void => {
    if (cycle || visited.has(id)) return
    if (visiting.has(id)) {
      const start = stack.indexOf(id)
      cycle = [...stack.slice(start), id]
      return
    }
    visiting.add(id)
    stack.push(id)
    for (const dependency of dependencies.get(id) ?? []) visit(dependency)
    stack.pop()
    visiting.delete(id)
    visited.add(id)
    order.push(id)
  }
  for (const definition of functions) visit(definition.id)

  return cycle ? { dependencies, order: [], cycle } : { dependencies, order }
}

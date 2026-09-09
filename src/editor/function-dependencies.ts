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
  calledModuleId?: string
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
  /** Module-only callee-before-caller order. Function declarations always
   * precede this list in generated source. */
  moduleOrder: readonly string[]
  /** Identifies the kind of the unsupported recursive dependency. */
  cycleKind?: 'function' | 'module'
}

export function analyzeFunctionDependencies(
  definitions: readonly FunctionDependencyDefinition[],
  nodes: readonly FunctionDependencyNode[],
  connections: readonly FunctionDependencyConnection[],
): FunctionDependencyAnalysis {
  const functions = definitions.filter((definition) => definition.kind === 'function')
  const modules = definitions.filter((definition) => definition.kind === 'module')
  const functionIds = new Set(functions.map((definition) => definition.id))
  const moduleIds = new Set(modules.map((definition) => definition.id))
  const nodeById = new Map(nodes.map((node) => [node.id, node]))
  const incoming = new Map<string, string[]>()
  for (const connection of connections) {
    const sources = incoming.get(connection.target) ?? []
    sources.push(connection.source)
    incoming.set(connection.target, sources)
  }

  const dependencies = new Map<string, ReadonlySet<string>>()
  const functionDependencies = new Map<string, ReadonlySet<string>>()
  const moduleDependencies = new Map<string, ReadonlySet<string>>()
  for (const definition of definitions) {
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
        if (node.calledModuleId && moduleIds.has(node.calledModuleId)) found.add(node.calledModuleId)
        pending.push(source)
      }
    }
    // `dependencies` is the complete effective view used by callers that
    // need to explain a Module's Function and Module callees. The two
    // declaration passes below deliberately use their kind-specific edges:
    // Functions must be emitted before every Module, while Module ordering
    // only needs Module→Module edges.
    dependencies.set(definition.id, found)
    if (definition.kind === 'function') functionDependencies.set(definition.id, new Set([...found].filter((id) => functionIds.has(id))))
    else moduleDependencies.set(definition.id, new Set([...found].filter((id) => moduleIds.has(id))))
  }

  const orderDependencies = (items: readonly FunctionDependencyDefinition[], edges: ReadonlyMap<string, ReadonlySet<string>>) => {
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
    for (const dependency of edges.get(id) ?? []) visit(dependency)
    stack.pop()
    visiting.delete(id)
    visited.add(id)
    order.push(id)
    }
    for (const definition of items) visit(definition.id)
    return { order, cycle }
  }
  const functionAnalysis = orderDependencies(functions, functionDependencies)
  if (functionAnalysis.cycle) return { dependencies, order: [], moduleOrder: [], cycle: functionAnalysis.cycle, cycleKind: 'function' }
  const moduleAnalysis = orderDependencies(modules, moduleDependencies)
  if (moduleAnalysis.cycle) return { dependencies, order: functionAnalysis.order, moduleOrder: [], cycle: moduleAnalysis.cycle, cycleKind: 'module' }

  return { dependencies, order: functionAnalysis.order, moduleOrder: moduleAnalysis.order }
}

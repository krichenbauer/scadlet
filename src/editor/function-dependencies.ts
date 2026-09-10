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
  /** Stable callee-before-caller order after collapsing recursive Function
   * components. Members of one component retain definition/project order. */
  order: readonly string[]
  /** Function SCCs in the same dependency order used by `order`. */
  functionComponents: readonly FunctionDependencyComponent[]
  /** A closed unsupported Module path such as `[A, B, A]`. Function-only
   * cycles are represented by `functionComponents`, not as an error. */
  cycle?: readonly string[]
  /** Module-only callee-before-caller order. Function declarations always
   * precede this list in generated source. */
  moduleOrder: readonly string[]
  /** Recursive Functions are supported, so only Module cycles are errors. */
  cycleKind?: 'module'
}

export interface FunctionDependencyComponent {
  members: readonly string[]
  recursive: boolean
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

  /** Tarjan SCCs replace the former Function-DAG assumption. Traversal and
   * condensation ordering are both normalized to stable project order so
   * connection insertion order cannot affect generated source. */
  const functionIndex = new Map(functions.map((definition, index) => [definition.id, index]))
  const sortedFunctionDependencies = (id: string): string[] =>
    [...(functionDependencies.get(id) ?? [])].sort((a, b) => functionIndex.get(a)! - functionIndex.get(b)!)
  let nextIndex = 0
  const indexes = new Map<string, number>()
  const lowlinks = new Map<string, number>()
  const stack: string[] = []
  const onStack = new Set<string>()
  const rawComponents: string[][] = []
  const connect = (id: string): void => {
    indexes.set(id, nextIndex)
    lowlinks.set(id, nextIndex)
    nextIndex += 1
    stack.push(id)
    onStack.add(id)
    for (const dependency of sortedFunctionDependencies(id)) {
      if (!indexes.has(dependency)) {
        connect(dependency)
        lowlinks.set(id, Math.min(lowlinks.get(id)!, lowlinks.get(dependency)!))
      } else if (onStack.has(dependency)) {
        lowlinks.set(id, Math.min(lowlinks.get(id)!, indexes.get(dependency)!))
      }
    }
    if (lowlinks.get(id) !== indexes.get(id)) return
    const component: string[] = []
    while (stack.length > 0) {
      const member = stack.pop()!
      onStack.delete(member)
      component.push(member)
      if (member === id) break
    }
    component.sort((a, b) => functionIndex.get(a)! - functionIndex.get(b)!)
    rawComponents.push(component)
  }
  for (const definition of functions) if (!indexes.has(definition.id)) connect(definition.id)

  const componentByFunction = new Map<string, number>()
  rawComponents.forEach((component, index) => {
    for (const member of component) componentByFunction.set(member, index)
  })
  const componentDependencies = new Map<number, Set<number>>()
  for (const definition of functions) {
    const owner = componentByFunction.get(definition.id)!
    const found = componentDependencies.get(owner) ?? new Set<number>()
    for (const dependency of functionDependencies.get(definition.id) ?? []) {
      const target = componentByFunction.get(dependency)!
      if (target !== owner) found.add(target)
    }
    componentDependencies.set(owner, found)
  }
  const componentProjectIndex = rawComponents.map((component) => Math.min(...component.map((id) => functionIndex.get(id)!)))
  const orderedComponentIndexes: number[] = []
  const visitedComponents = new Set<number>()
  const visitComponent = (index: number): void => {
    if (visitedComponents.has(index)) return
    visitedComponents.add(index)
    const dependenciesForComponent = [...(componentDependencies.get(index) ?? [])]
      .sort((a, b) => componentProjectIndex[a] - componentProjectIndex[b])
    for (const dependency of dependenciesForComponent) visitComponent(dependency)
    orderedComponentIndexes.push(index)
  }
  // Project-ordered roots preserve stable order between independent SCCs;
  // recursive DFS preserves every transitive callee-before-caller edge.
  for (const index of [...rawComponents.keys()].sort((a, b) => componentProjectIndex[a] - componentProjectIndex[b])) visitComponent(index)
  const functionComponents = orderedComponentIndexes.map((index): FunctionDependencyComponent => {
    const members = rawComponents[index]
    return {
      members,
      recursive: members.length > 1 || (functionDependencies.get(members[0])?.has(members[0]) ?? false),
    }
  })
  const functionOrder = functionComponents.flatMap((component) => component.members)
  const moduleAnalysis = orderDependencies(modules, moduleDependencies)
  if (moduleAnalysis.cycle) return { dependencies, order: functionOrder, functionComponents, moduleOrder: [], cycle: moduleAnalysis.cycle, cycleKind: 'module' }

  return { dependencies, order: functionOrder, functionComponents, moduleOrder: moduleAnalysis.order }
}

/** Minimal, implementation-independent view of project definitions used to
 * derive Call dependencies from the graph that can actually reach each
 * definition Output. Persistence validation and the live Rete editor both
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
  /** Stable Function callee-before-caller order after collapsing recursive
   * components. Members of one component retain definition/project order. */
  order: readonly string[]
  /** Function SCCs in the same dependency order used by `order`. */
  functionComponents: readonly FunctionDependencyComponent[]
  /** Module-only callee-before-caller order. Function declarations always
   * precede this list in generated source. */
  moduleOrder: readonly string[]
  /** Module SCCs in the same dependency order used by `moduleOrder`. */
  moduleComponents: readonly FunctionDependencyComponent[]
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

  const functionComponents = orderDependencyComponents(functions, functionDependencies)
  const moduleComponents = orderDependencyComponents(modules, moduleDependencies)
  const functionOrder = functionComponents.flatMap((component) => component.members)
  const moduleOrder = moduleComponents.flatMap((component) => component.members)
  return { dependencies, order: functionOrder, functionComponents, moduleOrder, moduleComponents }
}

/** Tarjan SCC ordering is shared by Functions and Modules. Traversal and
 * condensation ordering are normalized to stable project order, so neither
 * connection insertion order nor the shape of a recursive component can
 * change generated declaration order. */
function orderDependencyComponents(
  definitions: readonly FunctionDependencyDefinition[],
  dependencies: ReadonlyMap<string, ReadonlySet<string>>,
): FunctionDependencyComponent[] {
  const definitionIndex = new Map(definitions.map((definition, index) => [definition.id, index]))
  const sortedDependencies = (id: string): string[] =>
    [...(dependencies.get(id) ?? [])].sort((a, b) => definitionIndex.get(a)! - definitionIndex.get(b)!)
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
    for (const dependency of sortedDependencies(id)) {
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
    component.sort((a, b) => definitionIndex.get(a)! - definitionIndex.get(b)!)
    rawComponents.push(component)
  }
  for (const definition of definitions) if (!indexes.has(definition.id)) connect(definition.id)

  const componentByDefinition = new Map<string, number>()
  rawComponents.forEach((component, index) => {
    for (const member of component) componentByDefinition.set(member, index)
  })
  const componentDependencies = new Map<number, Set<number>>()
  for (const definition of definitions) {
    const owner = componentByDefinition.get(definition.id)!
    const found = componentDependencies.get(owner) ?? new Set<number>()
    for (const dependency of dependencies.get(definition.id) ?? []) {
      const target = componentByDefinition.get(dependency)!
      if (target !== owner) found.add(target)
    }
    componentDependencies.set(owner, found)
  }
  const componentProjectIndex = rawComponents.map((component) => Math.min(...component.map((id) => definitionIndex.get(id)!)))
  const orderedComponentIndexes: number[] = []
  const visitedComponents = new Set<number>()
  const visitComponent = (index: number): void => {
    if (visitedComponents.has(index)) return
    visitedComponents.add(index)
    const componentCallees = [...(componentDependencies.get(index) ?? [])]
      .sort((a, b) => componentProjectIndex[a] - componentProjectIndex[b])
    for (const callee of componentCallees) visitComponent(callee)
    orderedComponentIndexes.push(index)
  }
  for (const index of [...rawComponents.keys()].sort((a, b) => componentProjectIndex[a] - componentProjectIndex[b])) visitComponent(index)
  return orderedComponentIndexes.map((index): FunctionDependencyComponent => {
    const members = rawComponents[index]
    return {
      members,
      recursive: members.length > 1 || (dependencies.get(members[0])?.has(members[0]) ?? false),
    }
  })
}

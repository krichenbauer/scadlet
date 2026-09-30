import { findCatalogEntry } from './node-catalog'
import { t } from '../i18n/translate'

export interface LoopGraphNode {
  id: string
  type: string
  parameters: Record<string, unknown>
}

export interface LoopGraphConnection {
  id: string
  source: string
  sourceOutput: string
  target: string
  targetInput: string
}

export interface LoopStructureProblem {
  /** `name`: an iterator collides with a Value or parameter of its scope.
   * `shadow`: a nested iterator reuses an enclosing iterator's name while
   * its body still uses that enclosing iterator. */
  code: 'pair' | 'binding' | 'name' | 'shadow' | 'escape' | 'step'
  /** English diagnostic, used verbatim by `.scadlet` validation errors. */
  message: string
  /** The iterator name involved, for localized editor feedback. */
  iteratorName?: string
}

/** Localized learner feedback for a live editor or source-generation
 * refusal. File validation keeps each problem's English `message`. */
export function loopProblemFeedback(problem: LoopStructureProblem): string {
  const name = problem.iteratorName ?? ''
  if (problem.code === 'escape') return t('for.iteratorEscape')
  if (problem.code === 'shadow') return t('for.shadowedIteratorUsed').replaceAll('{name}', name)
  if (problem.code === 'name') return t('for.iteratorNameCollision').replace('{name}', name)
  return t('for.invalidPair')
}

function pairId(node: LoopGraphNode): string | undefined {
  return typeof node.parameters.pairId === 'string' ? node.parameters.pairId : undefined
}

/** Validates the durable pair and the iterator's lexical body boundary.
 * Visual positions never participate: containment is derived solely from
 * connections that eventually enter the matching For result. */
export function loopStructureProblem(
  nodes: readonly LoopGraphNode[],
  connections: readonly LoopGraphConnection[],
  enclosingBindingNames: ReadonlySet<string> = new Set(),
): LoopStructureProblem | null {
  const headers = nodes.filter((node) => node.type === 'for')
  const results = nodes.filter((node) => node.type === 'for-result')
  const headersByPair = new Map<string, LoopGraphNode[]>()
  const resultsByPair = new Map<string, LoopGraphNode[]>()
  for (const header of headers) headersByPair.set(pairId(header) ?? '', [...(headersByPair.get(pairId(header) ?? '') ?? []), header])
  for (const result of results) resultsByPair.set(pairId(result) ?? '', [...(resultsByPair.get(pairId(result) ?? '') ?? []), result])
  const allPairs = new Set([...headersByPair.keys(), ...resultsByPair.keys()])
  const resultByPair = new Map<string, LoopGraphNode>()
  const bindingIds = new Set<string>()

  for (const id of allPairs) {
    const pairHeaders = headersByPair.get(id) ?? []
    const pairResults = resultsByPair.get(id) ?? []
    if (!id || pairHeaders.length !== 1 || pairResults.length !== 1) {
      return { code: 'pair', message: `For pair "${id || '(missing)'}" must contain exactly one header and one result.` }
    }
    const header = pairHeaders[0]!
    const result = pairResults[0]!
    resultByPair.set(id, result)
    const bindingId = header.parameters.bindingId
    if (typeof bindingId !== 'string' || !bindingId || bindingIds.has(bindingId)) {
      return { code: 'binding', message: `For header "${header.id}" has a duplicate or invalid iterator binding.` }
    }
    bindingIds.add(bindingId)
    const name = header.parameters.name
    if (typeof name !== 'string' || enclosingBindingNames.has(name)) {
      return { code: 'name', message: `For iterator "${String(name)}" collides with a binding visible from its enclosing scope.`, iteratorName: String(name) }
    }
    const structural = connections.filter((connection) =>
      connection.source === header.id && connection.sourceOutput === 'loop'
        && connection.target === result.id && connection.targetInput === 'loop',
    )
    if (structural.length !== 1) return { code: 'pair', message: `For pair "${id}" is missing its fixed structural connection.` }
  }

  for (const connection of connections) {
    const source = nodes.find((node) => node.id === connection.source)
    const target = nodes.find((node) => node.id === connection.target)
    const structural = connection.sourceOutput === 'loop' || connection.targetInput === 'loop'
    if (!structural) continue
    if (source?.type !== 'for' || target?.type !== 'for-result' || pairId(source) !== pairId(target)
      || connection.sourceOutput !== 'loop' || connection.targetInput !== 'loop') {
      return { code: 'pair', message: `Connection "${connection.id}" is not a valid fixed For boundary.` }
    }
  }

  const nodeById = new Map(nodes.map((node) => [node.id, node]))
  const outgoing = new Map<string, LoopGraphConnection[]>()
  for (const edge of connections) {
    if (edge.sourceOutput === 'loop' || edge.targetInput === 'loop') continue
    outgoing.set(edge.source, [...(outgoing.get(edge.source) ?? []), edge])
  }
  const geometryProducer = (node: LoopGraphNode): boolean => {
    const entry = findCatalogEntry(node.type)
    return Boolean(entry?.outputs.some((output) => entry.outputSocketType(output, node.parameters) === 'geometry'))
  }
  const reaches = (sourceId: string, targetId: string): boolean => {
    const seen = new Set<string>()
    const pending = [sourceId]
    while (pending.length > 0) {
      const id = pending.pop()!
      if (id === targetId) return true
      if (seen.has(id)) continue
      seen.add(id)
      for (const edge of outgoing.get(id) ?? []) pending.push(edge.target)
    }
    return false
  }

  // Every edge by target, including structural ones: a deeper loop's range
  // is reached through its result's structural `loop` input.
  const incoming = new Map<string, LoopGraphConnection[]>()
  for (const edge of connections) incoming.set(edge.target, [...(incoming.get(edge.target) ?? []), edge])
  /** Whether the enclosing iterator is used inside the nested loop's body:
   * anything upstream of the nested result's Geometry slots, including the
   * ranges of deeper loops there. The nested header's own Start/Step/End are
   * evaluated in the enclosing scope and are not part of that body. */
  const usedInNestedBody = (innerHeader: LoopGraphNode, innerResult: LoopGraphNode, outerHeader: LoopGraphNode): boolean => {
    const outerBindingId = outerHeader.parameters.bindingId
    const seen = new Set<string>()
    const pending = (incoming.get(innerResult.id) ?? [])
      .filter((edge) => edge.targetInput.startsWith('child:'))
      .map((edge) => edge.source)
    while (pending.length > 0) {
      const id = pending.pop()!
      if (seen.has(id)) continue
      seen.add(id)
      if (id === outerHeader.id) return true
      const node = nodeById.get(id)
      if (node?.type === 'variable-reference' && node.parameters.bindingId === outerBindingId) return true
      if (id === innerHeader.id) continue
      for (const edge of incoming.get(id) ?? []) pending.push(edge.source)
    }
    return false
  }

  // Like OpenSCAD's lexical scoping, a nested iterator may reuse an enclosing
  // iterator's name and then hides it inside its body. Generated source
  // refers to bindings by name, so that is only safe while the nested body
  // does not also use the enclosing iterator. Sibling loops are independent.
  for (const inner of headers) {
    const innerResult = resultByPair.get(pairId(inner)!)!
    for (const outer of headers) {
      if (inner === outer || inner.parameters.name !== outer.parameters.name) continue
      const outerResult = resultByPair.get(pairId(outer)!)!
      if (reaches(innerResult.id, outerResult.id) && usedInNestedBody(inner, innerResult, outer)) {
        const name = String(inner.parameters.name)
        return {
          code: 'shadow',
          message: `Nested For iterator "${name}" shadows an enclosing iterator that is also used inside its body.`,
          iteratorName: name,
        }
      }
    }
  }

  const references = nodes.filter((node) => node.type === 'variable-reference')
  for (const header of headers) {
    const bindingId = String(header.parameters.bindingId)
    const matchingResult = resultByPair.get(pairId(header)!)!
    const origins = [header.id, ...references.filter((node) => node.parameters.bindingId === bindingId).map((node) => node.id)]
    const seen = new Set<string>()
    let escaped = false
    const visit = (nodeId: string, isOrigin = false): void => {
      const key = `${nodeId}:${isOrigin ? 'origin' : 'dependency'}`
      if (seen.has(key) || escaped) return
      seen.add(key)
      const edges = (outgoing.get(nodeId) ?? []).filter((edge) => !(isOrigin && nodeId === header.id && edge.sourceOutput !== 'value'))
      if (edges.length === 0) {
        const node = nodeById.get(nodeId)
        if (!isOrigin && node && geometryProducer(node) && node.id !== matchingResult.id) escaped = true
        return
      }
      for (const edge of edges) {
        if (edge.target === matchingResult.id && edge.targetInput.startsWith('child:')) continue
        const target = nodeById.get(edge.target)
        if (!target) { escaped = true; return }
        const scopeRoot = target.type === 'scad-settings'
          || (['number', 'boolean', 'vector3'].includes(target.type) && typeof target.parameters.bindingId === 'string')
        if (scopeRoot) { escaped = true; return }
        visit(target.id)
        if (target.type === 'for' && ['start', 'step', 'end'].includes(edge.targetInput)) {
          const nestedResult = resultByPair.get(pairId(target) ?? '')
          if (nestedResult) visit(nestedResult.id)
        }
      }
    }
    for (const origin of origins) visit(origin, true)
    if (escaped) return { code: 'escape', message: `Iterator "${String(header.parameters.name)}" contributes outside its matching For result.` }
  }

  return null
}

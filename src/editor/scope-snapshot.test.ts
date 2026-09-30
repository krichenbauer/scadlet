import { ClassicPreset, NodeEditor } from 'rete'
import { describe, expect, it } from 'vitest'

import { bindDefinitionRegistry, DefinitionRegistry } from './definitions'
import { findCatalogEntry, identifyNodeType, NODE_CATALOG } from './node-catalog'
import type { Schemes } from './schemes'
import { liveScopeSnapshot, upstreamNodeIds } from './scope-snapshot'

const context = { onControlsChanged: () => {}, resolveVariableBinding: () => ({ id: 'n-binding', name: 'n', type: 'number' as const }) }
const create = (type: string, id: string, params?: Record<string, unknown>) => {
  const node = NODE_CATALOG.find((entry) => entry.type === type)!.create(context, params)
  node.id = id
  return node
}

async function twoScopes() {
  const editor = new NodeEditor<Schemes>()
  const definitions = new DefinitionRegistry()
  bindDefinitionRegistry(editor, definitions)
  definitions.add({ id: 'shape', kind: 'module', name: 'shape', inputsNodeId: 'shape-in', outputNodeId: 'shape-out', parameters: [{ id: 'size', name: 'size', type: 'number', default: 1 }], geometryInputs: [] })
  const header = create('for', 'header', { pairId: 'pair', bindingId: 'iterator', name: 'i', start: 0, step: 1, end: 3 })
  const result = create('for-result', 'result', { pairId: 'pair', children: [{ id: 'body' }] })
  const value = create('number', 'value', { value: 2, name: 'n', bindingId: 'n-binding' })
  const reference = create('variable-reference', 'reference', { bindingId: 'n-binding' })
  const cube = create('cube', 'cube')
  const inner = create('translate', 'inner', { x: 0, y: 0, z: 0, representation: 'xyz' })
  for (const node of [header, result, value, reference, cube, inner]) await editor.addNode(node)
  definitions.assignNode('shape', inner.id)
  const link = (source: Schemes['Node'], output: string, target: Schemes['Node'], input: string, id: string) => {
    const connection = new ClassicPreset.Connection(source, output, target, input) as Schemes['Connection']
    connection.id = id
    return editor.addConnection(connection)
  }
  await link(header, 'loop', result, 'loop', 'boundary')
  await link(cube, 'geometry', result, 'child:body', 'body')
  await link(reference, 'value', inner, 'x', 'cross-scope')
  return { editor, definitions }
}

/** The construction each call site used before the shared helper. */
function inlineSnapshot(editor: NodeEditor<Schemes>, definitions: DefinitionRegistry | undefined, scope: string | null, overrideId?: string, override?: Record<string, unknown>) {
  const nodes = editor.getNodes().filter((node) => (definitions?.scopeOf(node.id) ?? null) === scope).flatMap((node) => {
    const type = identifyNodeType(node)
    const entry = type ? findCatalogEntry(type) : undefined
    if (!type || !entry) return []
    const parameters = entry.serializeParams(node)
    return [{ id: node.id, type, parameters: node.id === overrideId ? { ...parameters, ...override } : parameters }]
  })
  const ids = new Set(nodes.map((node) => node.id))
  const connections = editor.getConnections().filter((edge) => ids.has(edge.source) && ids.has(edge.target)).map((edge) => ({
    id: edge.id, source: edge.source, sourceOutput: String(edge.sourceOutput), target: edge.target, targetInput: String(edge.targetInput),
  }))
  return { nodes, connections }
}

describe('liveScopeSnapshot', () => {
  it('captures one scope in editor order with persisted parameters and only its internal connections', async () => {
    const { editor, definitions } = await twoScopes()
    const main = liveScopeSnapshot(editor, definitions, null)
    expect(main.nodes.map((node) => node.id)).toEqual(['header', 'result', 'value', 'reference', 'cube'])
    expect(main.nodes[0]).toEqual({ id: 'header', type: 'for', parameters: { pairId: 'pair', bindingId: 'iterator', name: 'i', start: 0, step: 1, end: 3 } })
    expect(main.connections.map((edge) => edge.id)).toEqual(['boundary', 'body'])
    expect(liveScopeSnapshot(editor, definitions, 'shape')).toEqual({ nodes: [expect.objectContaining({ id: 'inner', type: 'translate' })], connections: [] })
  })

  it('matches the former inline construction for every scope, an override, and a Main-only host', async () => {
    const { editor, definitions } = await twoScopes()
    expect(liveScopeSnapshot(editor, definitions, null)).toEqual(inlineSnapshot(editor, definitions, null))
    expect(liveScopeSnapshot(editor, definitions, 'shape')).toEqual(inlineSnapshot(editor, definitions, 'shape'))
    const renamed = { ...findCatalogEntry('for')!.serializeParams(editor.getNode('header')!), name: 'k' }
    expect(liveScopeSnapshot(editor, definitions, null, new Map([['header', renamed]]))).toEqual(inlineSnapshot(editor, definitions, null, 'header', { name: 'k' }))
    expect(liveScopeSnapshot(editor, undefined, null)).toEqual(inlineSnapshot(editor, undefined, null))
    // The override only replaces that node's parameters.
    const overridden = liveScopeSnapshot(editor, definitions, null, new Map([['header', renamed]]))
    expect(overridden.nodes.find((node) => node.id === 'header')!.parameters.name).toBe('k')
    expect(overridden.nodes.find((node) => node.id === 'value')!.parameters.name).toBe('n')
  })
})

describe('upstreamNodeIds', () => {
  it('collects the roots and everything they depend on, and nothing downstream', () => {
    const edges = [{ source: 'a', target: 'b' }, { source: 'b', target: 'c' }, { source: 'x', target: 'c' }, { source: 'c', target: 'd' }]
    expect([...upstreamNodeIds(edges, ['c'])].sort()).toEqual(['a', 'b', 'c', 'x'])
    expect([...upstreamNodeIds(edges, ['a'])]).toEqual(['a'])
    expect(upstreamNodeIds(edges, [])).toEqual(new Set())
  })
})

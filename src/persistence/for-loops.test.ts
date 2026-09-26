import { NodeEditor } from 'rete'
import { DataflowEngine } from 'rete-engine'
import { describe, expect, it } from 'vitest'

import { DefinitionRegistry } from '../editor/definitions'
import { evaluateInspectNode, evaluateOpenSCAD } from '../editor/evaluate'
import type { Schemes } from '../editor/schemes'
import { restoreProject } from './restore'
import { serializeProject } from './serialize'
import { parseScadletProject } from './validate'

const camera = { position: [80, 80, 60] as [number, number, number], target: [0, 0, 0] as [number, number, number] }

function project(): any {
  return {
    format: 'scadlet', version: 8, metadata: { name: 'For loop' }, definitions: [],
    graph: {
      nodes: [
        { id: 'for-header', type: 'for', position: { x: 0, y: 0 }, parameters: { pairId: 'pair', bindingId: 'iterator', name: 'i', start: 0, step: 1, end: 3 } },
        { id: 'cube', type: 'cube', position: { x: 180, y: 120 }, parameters: {} },
        { id: 'translate', type: 'translate', position: { x: 360, y: 120 }, parameters: { x: 0, y: 0, z: 0, representation: 'xyz' } },
        { id: 'for-result', type: 'for-result', position: { x: 600, y: 0 }, parameters: { pairId: 'pair', children: [{ id: 'body' }, { id: 'next' }] } },
      ],
      connections: [
        { id: 'boundary', source: 'for-header', sourceOutput: 'loop', target: 'for-result', targetInput: 'loop' },
        { id: 'iterator-x', source: 'for-header', sourceOutput: 'value', target: 'translate', targetInput: 'x' },
        { id: 'cube-translate', source: 'cube', sourceOutput: 'geometry', target: 'translate', targetInput: 'geometry' },
        { id: 'body', source: 'translate', sourceOutput: 'geometry', target: 'for-result', targetInput: 'child:body' },
      ],
    },
    editor: { viewport: { x: 0, y: 0, zoom: 1 } }, viewer: { camera },
  }
}

async function restore(raw: unknown) {
  const parsed = parseScadletProject(raw)
  const editor = new NodeEditor<Schemes>()
  const engine = new DataflowEngine<Schemes>((node) => ({ inputs: () => Object.keys(node.inputs), outputs: () => Object.keys(node.outputs) }))
  editor.use(engine)
  const definitions = new DefinitionRegistry()
  await restoreProject(parsed, {
    editor,
    creationContext: { onControlsChanged: () => {}, getModuleDefinition: (id) => definitions.get(id) },
    setNodePosition: () => {}, clearDefinitions: () => definitions.clear(), registerDefinition: (item) => definitions.add(item),
    assignNodeToDefinition: (definitionId, nodeId) => definitions.assignNode(definitionId, nodeId),
  })
  return { parsed, editor, engine, definitions }
}

describe('numeric For persistence and source generation', () => {
  it('round-trips a structurally valid empty pair and omits it from source and Inspect', async () => {
    const raw = structuredClone(project())
    raw.graph.nodes = raw.graph.nodes.filter((node: { type: string }) => node.type === 'for' || node.type === 'for-result')
    raw.graph.nodes.find((node: { type: string }) => node.type === 'for-result').parameters.children = [
      { id: 'later' }, { id: 'body' }, { id: 'next' },
    ]
    raw.graph.connections = raw.graph.connections.filter((edge: { id: string }) => edge.id === 'boundary')

    const { editor, engine, definitions } = await restore(raw)
    await expect(evaluateOpenSCAD(editor, engine, undefined, definitions)).resolves.toBe('')
    await expect(evaluateInspectNode(editor, engine, 'for-result', definitions)).resolves.toEqual({ kind: 'geometry', source: '' })
    expect(Object.keys(editor.getNode('for-result')!.inputs)).toEqual([
      'loop', 'child:later', 'child:body', 'child:next',
    ])

    const saved = serializeProject({
      editor, metadata: { name: 'Empty For loop' }, getNodePosition: () => ({ x: 0, y: 0 }), viewport: { x: 0, y: 0, k: 1 },
      viewerCamera: camera, definitions: definitions.list(), getNodeScope: (id) => definitions.scopeOf(id), now: () => '2026-09-26T00:00:00.000Z',
    })
    expect(saved.graph.connections).toEqual([
      expect.objectContaining({ sourceOutput: 'loop', targetInput: 'loop' }),
    ])
    expect(saved.graph.nodes.find((node) => node.type === 'for-result')?.parameters).toEqual({
      pairId: 'pair', children: [{ id: 'later' }, { id: 'body' }, { id: 'next' }],
    })
    expect(parseScadletProject(saved).graph.nodes).toHaveLength(2)
  })

  it('restores a fixed pair and generates the iterator range around its Geometry body', async () => {
    const { editor, engine, definitions } = await restore(project())
    expect(await evaluateOpenSCAD(editor, engine, undefined, definitions)).toBe(
      'for (i = [0 : 1 : 3]) {\n  translate([i, 0, 0]) {\n      cube();\n  }\n}',
    )
    const saved = serializeProject({
      editor, metadata: { name: 'For loop' }, getNodePosition: () => ({ x: 0, y: 0 }), viewport: { x: 0, y: 0, k: 1 },
      viewerCamera: camera, definitions: definitions.list(), getNodeScope: (id) => definitions.scopeOf(id), now: () => '2026-09-26T00:00:00.000Z',
    })
    expect(saved.version).toBe(8)
    expect(saved.graph.connections.find((connection) => connection.id === 'boundary')).toMatchObject({ sourceOutput: 'loop', targetInput: 'loop' })
    expect(saved.graph.nodes.find((node) => node.id === 'for-header')?.parameters).toMatchObject({ pairId: 'pair', bindingId: 'iterator', name: 'i' })
  })

  it('uses iterator references and enclosing bindings inside ordered body branches', async () => {
    const raw = structuredClone(project())
    raw.graph.nodes.push(
      { id: 'iterator-ref', type: 'variable-reference', position: { x: 0, y: 0 }, parameters: { bindingId: 'iterator' } },
      { id: 'spacing', type: 'number', position: { x: 0, y: 0 }, parameters: { value: 5, name: 'spacing', bindingId: 'spacing-binding' } },
      { id: 'spacing-ref', type: 'variable-reference', position: { x: 0, y: 0 }, parameters: { bindingId: 'spacing-binding' } },
      { id: 'sphere', type: 'sphere', position: { x: 0, y: 0 }, parameters: {} },
    )
    raw.graph.nodes.find((node: { id: string }) => node.id === 'for-result').parameters.children = [{ id: 'body' }, { id: 'second' }, { id: 'next' }]
    raw.graph.connections = raw.graph.connections.filter((edge: { id: string }) => edge.id !== 'iterator-x')
    raw.graph.connections.push(
      { id: 'iterator-ref-x', source: 'iterator-ref', sourceOutput: 'value', target: 'translate', targetInput: 'x' },
      { id: 'spacing-y', source: 'spacing-ref', sourceOutput: 'value', target: 'translate', targetInput: 'y' },
      { id: 'spacing-z-direct', source: 'spacing', sourceOutput: 'value', target: 'translate', targetInput: 'z' },
      { id: 'second-body', source: 'sphere', sourceOutput: 'geometry', target: 'for-result', targetInput: 'child:second' },
    )
    const { editor, engine, definitions } = await restore(raw)
    const source = await evaluateOpenSCAD(editor, engine, undefined, definitions)
    expect(source).toContain('spacing = 5;\nfor (i = [0 : 1 : 3])')
    expect(source).toContain('translate([i, spacing, 5])')
    expect(source.indexOf('translate(')).toBeLessThan(source.indexOf('sphere();'))
  })

  it('generates nested loops and rejects iterator shadowing or use in another sibling body', async () => {
    const raw = structuredClone(project())
    raw.graph.nodes = [
      { id: 'outer-header', type: 'for', position: { x: 0, y: 0 }, parameters: { pairId: 'outer', bindingId: 'outer-i', name: 'i', start: 0, step: 1, end: 2 } },
      { id: 'inner-header', type: 'for', position: { x: 0, y: 0 }, parameters: { pairId: 'inner', bindingId: 'inner-j', name: 'j', start: 0, step: 1, end: 1 } },
      { id: 'cube', type: 'cube', position: { x: 0, y: 0 }, parameters: {} },
      { id: 'translate', type: 'translate', position: { x: 0, y: 0 }, parameters: { x: 0, y: 0, z: 0, representation: 'xyz' } },
      { id: 'inner-result', type: 'for-result', position: { x: 0, y: 0 }, parameters: { pairId: 'inner', children: [{ id: 'inner-body' }, { id: 'inner-next' }] } },
      { id: 'outer-result', type: 'for-result', position: { x: 0, y: 0 }, parameters: { pairId: 'outer', children: [{ id: 'outer-body' }, { id: 'outer-next' }] } },
    ]
    raw.graph.connections = [
      { id: 'outer-boundary', source: 'outer-header', sourceOutput: 'loop', target: 'outer-result', targetInput: 'loop' },
      { id: 'inner-boundary', source: 'inner-header', sourceOutput: 'loop', target: 'inner-result', targetInput: 'loop' },
      { id: 'outer-range', source: 'outer-header', sourceOutput: 'value', target: 'inner-header', targetInput: 'end' },
      { id: 'inner-x', source: 'inner-header', sourceOutput: 'value', target: 'translate', targetInput: 'x' },
      { id: 'cube-translate', source: 'cube', sourceOutput: 'geometry', target: 'translate', targetInput: 'geometry' },
      { id: 'inner-body', source: 'translate', sourceOutput: 'geometry', target: 'inner-result', targetInput: 'child:inner-body' },
      { id: 'outer-body', source: 'inner-result', sourceOutput: 'geometry', target: 'outer-result', targetInput: 'child:outer-body' },
    ]
    const { editor, engine, definitions } = await restore(raw)
    expect(await evaluateOpenSCAD(editor, engine, undefined, definitions)).toContain(
      'for (i = [0 : 1 : 2]) {\n  for (j = [0 : 1 : i])',
    )
    await expect(evaluateInspectNode(editor, engine, 'inner-result', definitions)).rejects.toThrow('matching For result body')
    await expect(evaluateInspectNode(editor, engine, 'outer-result', definitions)).resolves.toMatchObject({
      kind: 'geometry', source: expect.stringContaining('for (j = [0 : 1 : i])'),
    })

    const shadow = structuredClone(raw)
    shadow.graph.nodes.find((node: { id: string }) => node.id === 'inner-header').parameters.name = 'i'
    expect(() => parseScadletProject(shadow)).toThrow('shadows an enclosing iterator')

    const siblingEscape = structuredClone(raw)
    siblingEscape.graph.connections = siblingEscape.graph.connections.filter((edge: { id: string }) => edge.id !== 'outer-body' && edge.id !== 'outer-range')
    siblingEscape.graph.connections.push({ id: 'wrong-loop', source: 'outer-header', sourceOutput: 'value', target: 'translate', targetInput: 'y' })
    expect(() => parseScadletProject(siblingEscape)).toThrow('contributes outside')
  })

  it('places a loop inside a Module body and rejects known connected zero steps', async () => {
    const raw = structuredClone(project())
    const nodes = raw.graph.nodes
    const connections = raw.graph.connections
    raw.graph = {
      nodes: [{ id: 'call', type: 'module-call', position: { x: 0, y: 0 }, parameters: { definitionId: 'parts', arguments: {} } }],
      connections: [],
    }
    raw.definitions = [{
      id: 'parts', kind: 'module', name: 'parts', interface: { inputs: 'inputs', output: 'output' }, parameters: [], geometryInputs: [],
      graph: {
        nodes: [
          { id: 'inputs', type: 'module-inputs', position: { x: 0, y: 0 }, parameters: {} },
          ...nodes,
          { id: 'output', type: 'module-output', position: { x: 0, y: 0 }, parameters: {} },
        ],
        connections: [...connections, { id: 'module-body', source: 'for-result', sourceOutput: 'geometry', target: 'output', targetInput: 'geometry' }],
      },
    }]
    const { editor, engine, definitions } = await restore(raw)
    expect(await evaluateOpenSCAD(editor, engine, undefined, definitions)).toContain(
      'module parts() {\n  for (i = [0 : 1 : 3])',
    )

    const zero = structuredClone(project())
    zero.graph.nodes.push({ id: 'zero', type: 'number', position: { x: 0, y: 0 }, parameters: { value: 0, name: 'Number' } })
    zero.graph.connections.push({ id: 'zero-step', source: 'zero', sourceOutput: 'value', target: 'for-header', targetInput: 'step' })
    const restored = await restore(zero)
    await expect(evaluateOpenSCAD(restored.editor, restored.engine, undefined, restored.definitions)).rejects.toThrow('must not be zero')
  })

  it('rejects orphaned, mismatched, duplicate, zero-step, stale-reference, and escaping iterator data', () => {
    const orphan = structuredClone(project())
    orphan.graph.nodes = orphan.graph.nodes.filter((node: { id: string }) => node.id !== 'for-result')
    orphan.graph.connections = orphan.graph.connections.filter((edge: { target: string }) => edge.target !== 'for-result')
    expect(() => parseScadletProject(orphan)).toThrow('exactly one header and one result')

    const mismatched = structuredClone(project())
    mismatched.graph.nodes.find((node: { id: string }) => node.id === 'for-result')!.parameters.pairId = 'other'
    expect(() => parseScadletProject(mismatched)).toThrow('exactly one header and one result')

    const duplicate = structuredClone(project())
    duplicate.graph.nodes.push({ id: 'other-result', type: 'for-result', position: { x: 0, y: 0 }, parameters: { pairId: 'pair', children: [{ id: 'slot' }] } })
    expect(() => parseScadletProject(duplicate)).toThrow('exactly one header and one result')

    const missingBoundary = structuredClone(project())
    missingBoundary.graph.connections = missingBoundary.graph.connections.filter((edge: { id: string }) => edge.id !== 'boundary')
    expect(() => parseScadletProject(missingBoundary)).toThrow('missing its fixed structural connection')

    const zero = structuredClone(project())
    zero.graph.nodes.find((node: { id: string }) => node.id === 'for-header')!.parameters.step = 0
    expect(() => parseScadletProject(zero)).toThrow('zero step')

    const stale = structuredClone(project())
    stale.graph.nodes.push({ id: 'stale', type: 'variable-reference', position: { x: 0, y: 0 }, parameters: { bindingId: 'missing' } })
    expect(() => parseScadletProject(stale)).toThrow('missing, stale, or cross-scope')

    const escape = structuredClone(project())
    escape.graph.nodes.push({ id: 'outside', type: 'cube', position: { x: 0, y: 0 }, parameters: { sizeRepresentation: 'scalar', size: 2, sizeScalar: 2, sizeVector: { x: 2, y: 2, z: 2 } } })
    escape.graph.connections.push({ id: 'escape', source: 'for-header', sourceOutput: 'value', target: 'outside', targetInput: 'size' })
    expect(() => parseScadletProject(escape)).toThrow('contributes outside')

    const scopeValueEscape = structuredClone(project())
    scopeValueEscape.graph.nodes.push({ id: 'loop-local', type: 'number', position: { x: 0, y: 0 }, parameters: { value: 0, name: 'loop_local', bindingId: 'loop-local-binding' } })
    scopeValueEscape.graph.connections.push({ id: 'scope-value-escape', source: 'for-header', sourceOutput: 'value', target: 'loop-local', targetInput: 'value' })
    expect(() => parseScadletProject(scopeValueEscape)).toThrow('contributes outside')

    const collision = structuredClone(project())
    collision.graph.nodes.push({ id: 'named-i', type: 'number', position: { x: 0, y: 0 }, parameters: { value: 1, name: 'i', bindingId: 'named-i' } })
    expect(() => parseScadletProject(collision)).toThrow('collides with a binding visible')

    const wrongType = structuredClone(project())
    wrongType.graph.connections.push({ id: 'geometry-range', source: 'cube', sourceOutput: 'geometry', target: 'for-header', targetInput: 'start' })
    expect(() => parseScadletProject(wrongType)).toThrow('geometry output cannot connect to number input')

    const booleanRange = structuredClone(project())
    booleanRange.graph.nodes.push({ id: 'flag', type: 'boolean', position: { x: 0, y: 0 }, parameters: { value: true, name: 'Boolean' } })
    booleanRange.graph.connections.push({ id: 'boolean-range', source: 'flag', sourceOutput: 'value', target: 'for-header', targetInput: 'end' })
    expect(() => parseScadletProject(booleanRange)).toThrow('boolean output cannot connect to number input')

    const siblings = structuredClone(project())
    siblings.graph.nodes.push(
      { id: 'sibling-header', type: 'for', position: { x: 0, y: 0 }, parameters: { pairId: 'sibling', bindingId: 'sibling-i', name: 'i', start: 1, step: 1, end: 2 } },
      { id: 'sibling-cube', type: 'cube', position: { x: 0, y: 0 }, parameters: {} },
      { id: 'sibling-result', type: 'for-result', position: { x: 0, y: 0 }, parameters: { pairId: 'sibling', children: [{ id: 'body' }, { id: 'next' }] } },
    )
    siblings.graph.connections.push(
      { id: 'sibling-boundary', source: 'sibling-header', sourceOutput: 'loop', target: 'sibling-result', targetInput: 'loop' },
      { id: 'sibling-body', source: 'sibling-cube', sourceOutput: 'geometry', target: 'sibling-result', targetInput: 'child:body' },
    )
    expect(parseScadletProject(siblings).graph.nodes.filter((node) => node.type === 'for')).toHaveLength(2)
  })

  it('keeps older v7 projects unchanged while migrating them to the current format', () => {
    const old = structuredClone(project())
    old.version = 7
    old.graph.nodes = old.graph.nodes.filter((node: { type: string }) => node.type !== 'for' && node.type !== 'for-result')
    old.graph.connections = old.graph.connections.filter((edge: { source: string; target: string }) => !edge.source.startsWith('for-') && !edge.target.startsWith('for-'))
    expect(parseScadletProject(old).version).toBe(8)
  })
})

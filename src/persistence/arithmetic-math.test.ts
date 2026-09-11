import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { NodeEditor } from 'rete'
import { DataflowEngine } from 'rete-engine'
import { describe, expect, it } from 'vitest'

import { DefinitionRegistry } from '../editor/definitions'
import { evaluateOpenSCAD } from '../editor/evaluate'
import { findCatalogEntry } from '../editor/node-catalog'
import { ArithmeticNode, BasicMathNode, CompareNode, ExponentialLogNode, TrigonometryNode } from '../editor/nodes/value-nodes'
import type { Schemes } from '../editor/schemes'
import { restoreProject } from './restore'
import { serializeProject } from './serialize'
import { parseScadletProject } from './validate'

const fixturePath = fileURLToPath(new URL('./fixtures/arithmetic-v5.scadlet', import.meta.url))
const legacyV5 = JSON.parse(readFileSync(fixturePath, 'utf8'))

function engine() {
  return new DataflowEngine<Schemes>((node) => ({ inputs: () => Object.keys(node.inputs), outputs: () => Object.keys(node.outputs) }))
}

describe('Arithmetic/math persistence v6', () => {
  it('migrates a static v5 fixture in Main, Module, and Function scopes without changing ids, positions, ports, wires, or source', async () => {
    const project = parseScadletProject(legacyV5)
    expect(project.version).toBe(6)
    const allNodes = [...project.graph.nodes, ...project.definitions.flatMap((definition) => definition.graph.nodes)]
    const migrated = allNodes.filter((node) => ['add-main', 'subtract-main', 'multiply-main', 'divide-main', 'module-add', 'function-divide'].includes(node.id))
    expect(migrated.map((node) => [node.id, node.type, node.parameters.operation])).toEqual([
      ['add-main', 'arithmetic', 'addition'],
      ['subtract-main', 'arithmetic', 'subtraction'],
      ['multiply-main', 'arithmetic', 'multiplication'],
      ['divide-main', 'arithmetic', 'division'],
      ['module-add', 'arithmetic', 'addition'],
      ['function-divide', 'arithmetic', 'division'],
    ])
    expect(project.graph.nodes.find((node) => node.id === 'add-main')).toMatchObject({ position: { x: 100, y: 20 }, pinned: true })
    expect(project.graph.connections).toEqual(legacyV5.graph.connections)
    expect(project.definitions[0]?.graph.connections).toEqual(legacyV5.definitions[0].graph.connections)
    expect(project.definitions[1]?.graph.connections).toEqual(legacyV5.definitions[1].graph.connections)

    const editor = new NodeEditor<Schemes>()
    const dataflow = engine(); editor.use(dataflow)
    const definitions = new DefinitionRegistry()
    await restoreProject(project, {
      editor,
      creationContext: { onControlsChanged: () => {}, getModuleDefinition: (id) => definitions.get(id) },
      setNodePosition: () => {}, clearDefinitions: () => definitions.clear(), registerDefinition: (definition) => definitions.add(definition),
      assignNodeToDefinition: (definitionId, nodeId) => definitions.assignNode(definitionId, nodeId),
    })
    expect(editor.getNode('add-main')).toBeInstanceOf(ArithmeticNode)
    await expect(evaluateOpenSCAD(editor, dataflow, undefined, definitions)).resolves.toBe(
      'function legacy_function() = (12 / 3);\n\nmodule legacy_module() {\n  cube((2 + 3));\n}\n\ncube(((((2 + 3) - 1) * 4) / 2));',
    )
  })

  it('keeps the historical v4 -> v5 -> v6 migration chain valid', () => {
    const raw = structuredClone(legacyV5)
    raw.version = 4
    raw.definitions = []
    expect(parseScadletProject(raw).graph.nodes.find((node) => node.id === 'add-main')).toMatchObject({
      type: 'arithmetic', parameters: { operation: 'addition', a: 0, b: 3 },
    })
  })

  it('accepts all Number families, including Compare fallbacks, in Main, Module, and Function scopes', () => {
    const familyNodes = (suffix: string) => [
      { id: `arithmetic-${suffix}`, type: 'arithmetic', position: { x: 0, y: 0 }, parameters: { operation: 'power', a: 2, b: 3 } },
      { id: `trig-${suffix}`, type: 'trigonometry', position: { x: 0, y: 0 }, parameters: { operation: 'atan2', a: 2, b: 3, inputPorts: ['a', 'b'] } },
      { id: `basic-${suffix}`, type: 'basic-math', position: { x: 0, y: 0 }, parameters: { operation: 'sqrt', x: 4 } },
      { id: `exp-${suffix}`, type: 'exponential-log', position: { x: 0, y: 0 }, parameters: { operation: 'ln', x: 4 } },
      { id: `compare-${suffix}`, type: 'compare', position: { x: 0, y: 0 }, parameters: { operator: '>', a: 3, b: 10 } },
    ]
    const raw = {
      format: 'scadlet', version: 6, metadata: { name: 'All scopes' },
      graph: { nodes: familyNodes('main'), connections: [] },
      definitions: [
        { id: 'module', kind: 'module', name: 'module_math', interface: { inputs: 'module-in', output: 'module-out' }, parameters: [], geometryInputs: [], graph: { nodes: [
          { id: 'module-in', type: 'module-inputs', position: { x: 0, y: 0 }, parameters: {} }, ...familyNodes('module'),
          { id: 'module-out', type: 'module-output', position: { x: 0, y: 0 }, parameters: {} },
        ], connections: [] } },
        { id: 'function', kind: 'function', name: 'function_math', interface: { inputs: 'function-in', output: 'function-out' }, parameters: [], graph: { nodes: [
          { id: 'function-in', type: 'function-inputs', position: { x: 0, y: 0 }, parameters: {} }, ...familyNodes('function'),
          { id: 'function-out', type: 'function-output', position: { x: 0, y: 0 }, parameters: {} },
        ], connections: [] } },
      ],
      editor: { viewport: { x: 0, y: 0, zoom: 1 } }, viewer: { camera: { position: [80, 80, 60], target: [0, 0, 0] } },
    }
    const project = parseScadletProject(raw)
    expect(project.graph.nodes).toHaveLength(5)
    expect(project.definitions.map((definition) => definition.graph.nodes.length)).toEqual([7, 7])
    expect(project.graph.nodes.find((node) => node.id === 'compare-main')?.parameters).toEqual({ operator: '>', a: 3, b: 10 })
    expect(project.definitions.flatMap((definition) => definition.graph.nodes).filter((node) => node.type === 'compare').map((node) => node.parameters)).toEqual([
      { operator: '>', a: 3, b: 10 }, { operator: '>', a: 3, b: 10 },
    ])
  })

  it('rejects wrong-family operations and malformed dynamic Trigonometry port metadata/wires', () => {
    const base = {
      format: 'scadlet', version: 6, metadata: { name: 'Bad math' }, definitions: [],
      graph: { nodes: [], connections: [] }, editor: { viewport: { x: 0, y: 0, zoom: 1 } },
      viewer: { camera: { position: [80, 80, 60], target: [0, 0, 0] } },
    }
    const withNode = (node: unknown, connections: unknown[] = []) => ({ ...base, graph: { nodes: [node], connections } })
    expect(() => parseScadletProject(withNode({ id: 'a', type: 'arithmetic', position: { x: 0, y: 0 }, parameters: { operation: 'sin', a: 0, b: 0 } }))).toThrow(/Arithmetic operation/)
    expect(() => parseScadletProject(withNode({ id: 'b', type: 'basic-math', position: { x: 0, y: 0 }, parameters: { operation: 'ln', x: 0 } }))).toThrow(/Basic Math operation/)
    expect(() => parseScadletProject(withNode({ id: 'e', type: 'exponential-log', position: { x: 0, y: 0 }, parameters: { operation: 'sqrt', x: 0 } }))).toThrow(/Exponential \/ Logarithmic operation/)
    expect(() => parseScadletProject(withNode({ id: 't', type: 'trigonometry', position: { x: 0, y: 0 }, parameters: { operation: 'abs', a: 0, b: 0, inputPorts: ['a'] } }))).toThrow(/Trigonometry operation/)
    expect(() => parseScadletProject(withNode({ id: 't', type: 'trigonometry', position: { x: 0, y: 0 }, parameters: { operation: 'atan2', a: 0, b: 0, inputPorts: ['a'] } }))).toThrow(/atan2 requires inputPorts/)
    expect(() => parseScadletProject(withNode({ id: 't', type: 'trigonometry', position: { x: 0, y: 0 }, parameters: { operation: 'atan2', a: 0, b: 0, inputPorts: ['a', 'b', 'b'] } }))).toThrow(/duplicate Trigonometry input ports/)
    expect(() => parseScadletProject({ ...base, graph: { nodes: [
      { id: 'n', type: 'number', position: { x: 0, y: 0 }, parameters: { value: 1 } },
      { id: 't', type: 'trigonometry', position: { x: 0, y: 0 }, parameters: { operation: 'sin', a: 0, b: 0, inputPorts: ['a'] } },
    ], connections: [{ id: 'bad', source: 'n', sourceOutput: 'value', target: 't', targetInput: 'b' }] } })).toThrow(/unknown target port "b"/)
    expect(() => parseScadletProject({ ...base, graph: { nodes: [
      { id: 'flag', type: 'boolean', position: { x: 0, y: 0 }, parameters: { value: true } },
      { id: 'math', type: 'basic-math', position: { x: 0, y: 0 }, parameters: { operation: 'sqrt', x: 0 } },
    ], connections: [{ id: 'bad-type', source: 'flag', sourceOutput: 'value', target: 'math', targetInput: 'x' }] } })).toThrow(/incompatible socket types/)
    expect(() => parseScadletProject({ ...base, graph: { nodes: [
      { id: 'one', type: 'number', position: { x: 0, y: 0 }, parameters: { value: 1 } },
      { id: 'two', type: 'number', position: { x: 0, y: 0 }, parameters: { value: 2 } },
      { id: 'trig', type: 'trigonometry', position: { x: 0, y: 0 }, parameters: { operation: 'sin', a: 0, b: 0, inputPorts: ['a'] } },
    ], connections: [
      { id: 'duplicate-1', source: 'one', sourceOutput: 'value', target: 'trig', targetInput: 'a' },
      { id: 'duplicate-2', source: 'two', sourceOutput: 'value', target: 'trig', targetInput: 'a' },
    ] } })).toThrow(/Multiple connections target input "a"/)
  })

  it('constructs every canonical family from validated v6 parameters', () => {
    expect(new ArithmeticNode({ operation: 'modulo', a: 5, b: 2 }).data({}).value.code).toBe('(5 % 2)')
    expect(new TrigonometryNode({ operation: 'atan2', a: 1, b: 2, inputPorts: ['a', 'b'] }).data({}).value.code).toBe('atan2(1, 2)')
    expect(new BasicMathNode({ operation: 'round', x: 1.2 }).data({}).value.code).toBe('round(1.2)')
    expect(new ExponentialLogNode({ operation: 'log', x: 10 }).data({}).value.code).toBe('log(10)')
    expect(new CompareNode({ operator: '>', a: 3, b: 10 }).data({}).value.code).toBe('(3 > 10)')
  })

  it('round-trips every family operation through canonical v6 serialization and restore', async () => {
    const cases: [string, Record<string, unknown>][] = [
      ...['addition', 'subtraction', 'multiplication', 'division', 'modulo', 'power'].map((operation) => ['arithmetic', { operation, a: 2, b: 3 }] as [string, Record<string, unknown>]),
      ...['sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'atan2'].map((operation) => ['trigonometry', { operation, a: 2, b: 3, inputPorts: operation === 'atan2' ? ['a', 'b'] : ['a'] }] as [string, Record<string, unknown>]),
      ...['abs', 'sign', 'sqrt', 'floor', 'ceil', 'round'].map((operation) => ['basic-math', { operation, x: 2 }] as [string, Record<string, unknown>]),
      ...['exp', 'ln', 'log'].map((operation) => ['exponential-log', { operation, x: 2 }] as [string, Record<string, unknown>]),
      ...['<', '<=', '>', '>=', '==', '!='].map((operator) => ['compare', { operator, a: 2, b: 3 }] as [string, Record<string, unknown>]),
    ]
    const source = new NodeEditor<Schemes>()
    for (const [index, [type, params]] of cases.entries()) {
      const entry = findCatalogEntry(type)!
      const node = entry.create({ onControlsChanged: () => {} }, entry.validateParams(params)); node.id = `math-${index}`
      await source.addNode(node)
    }
    const serialized = serializeProject({
      editor: source, metadata: { name: 'Every math operation' }, getNodePosition: (id) => ({ x: Number(id.split('-')[1]), y: 0 }),
      viewport: { x: 0, y: 0, k: 1 }, viewerCamera: { position: [80, 80, 60], target: [0, 0, 0] }, now: () => '2026-09-09T00:00:00.000Z',
    })
    const project = parseScadletProject(serialized)
    expect(project.version).toBe(6)
    expect(project.graph.nodes.map((node) => [node.type, node.parameters])).toEqual(cases)
    const target = new NodeEditor<Schemes>()
    await restoreProject(project, { editor: target, creationContext: { onControlsChanged: () => {} }, setNodePosition: () => {} })
    expect(target.getNodes()).toHaveLength(cases.length)
    expect(target.getNodes().map((node) => findCatalogEntry(project.graph.nodes.find((dto) => dto.id === node.id)!.type)!.serializeParams(node))).toEqual(cases.map(([, params]) => params))
  })
})

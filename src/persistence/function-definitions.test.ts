import { ClassicPreset, NodeEditor } from 'rete'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { DefinitionRegistry } from '../editor/definitions'
import { FunctionCallNode } from '../editor/nodes/function-call-node'
import { FunctionInputsNode, FunctionOutputNode } from '../editor/nodes/function-interface-nodes'
import { ArithmeticNode, BooleanNode, NumberNode, Vector3Node } from '../editor/nodes/value-nodes'
import type { Schemes } from '../editor/schemes'
import { restoreProject } from './restore'
import { serializeProject } from './serialize'
import { parseScadletProject, ScadletProjectError } from './validate'

const camera = { position: [0, 0, 0] as [number, number, number], target: [0, 0, 0] as [number, number, number] }
const recursiveFixture = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../docs/examples/recursive-functions-v6.scadlet'), 'utf8'))
const functionDefinition = {
  id: 'fn-double', kind: 'function' as const, name: 'double_size',
  inputsNodeId: 'fn-double-inputs', outputNodeId: 'fn-double-output',
  parameters: [{ id: 'x-id', name: 'x', type: 'number' as const, default: 1 }],
}

function serializeOptions(source: NodeEditor<Schemes>, registry: DefinitionRegistry, overrides: Partial<Parameters<typeof serializeProject>[0]> = {}) {
  return {
    editor: source,
    metadata: { name: 'Functions' },
    getNodePosition: () => ({ x: 0, y: 0 }),
    viewport: { x: 0, y: 0, k: 1 },
    viewerCamera: camera,
    definitions: registry.list(),
    getNodeScope: (id: string) => registry.scopeOf(id),
    now: () => '2026-09-06T00:00:00.000Z',
    ...overrides,
  }
}

describe('Function definition persistence (introduced in v5, retained in canonical v7)', () => {
  it('migrates a v4 Module-only project unchanged, with an empty Function registry', () => {
    const project = parseScadletProject({
      format: 'scadlet', version: 4,
      metadata: { name: 'Old modules only' },
      graph: { nodes: [], connections: [] },
      definitions: [],
      editor: { viewport: { x: 1, y: 2, zoom: 1 } }, viewer: { camera },
    })
    expect(project.version).toBe(7)
    expect(project.definitions).toEqual([])
  })

  it('round-trips a resolved Number-result Function, its parameter, and a Call with an independent fallback and connection', async () => {
    const source = new NodeEditor<Schemes>()
    const registry = new DefinitionRegistry()
    registry.add({ ...functionDefinition, resultType: 'number' })
    const inputs = new FunctionInputsNode(functionDefinition.parameters); inputs.id = functionDefinition.inputsNodeId
    const output = new FunctionOutputNode('number'); output.id = functionDefinition.outputNodeId
    const multiply = new ArithmeticNode({ operation: 'multiplication', a: 0, b: 2 }); multiply.id = 'fn-multiply'
    const call = new FunctionCallNode({ ...functionDefinition, resultType: 'number' }, { definitionId: functionDefinition.id }); call.id = 'main-call'
    const source1 = new NumberNode({ value: 7, name: 'seven' }); source1.id = 'source-7'
    for (const node of [inputs, output, multiply, call, source1]) await source.addNode(node)
    registry.assignNode(functionDefinition.id, multiply.id)
    await source.addConnection(new ClassicPreset.Connection(inputs, 'parameter:x-id', multiply, 'a') as Schemes['Connection'])
    await source.addConnection(new ClassicPreset.Connection(multiply, 'value', output, 'result') as Schemes['Connection'])
    await source.addConnection(new ClassicPreset.Connection(source1, 'value', call, 'parameter:x-id') as Schemes['Connection'])
    ;(call.controls['parameter:x-id'] as unknown as { setValue(value: number): void }).setValue(99)

    const project = parseScadletProject(serializeProject(serializeOptions(source, registry)))
    expect(project.definitions).toHaveLength(1)
    const definitionDto = project.definitions[0]!
    expect(definitionDto.kind).toBe('function')
    if (definitionDto.kind !== 'function') throw new Error('unreachable')
    expect(definitionDto.resultType).toBe('number')
    expect(definitionDto.graph.nodes.map((node) => node.id)).toEqual([inputs.id, output.id, multiply.id])
    expect(project.graph.nodes.find((node) => node.id === call.id)).toMatchObject({ id: call.id, type: 'function-call', parameters: { definitionId: functionDefinition.id, arguments: { 'x-id': 99 } } })

    const target = new NodeEditor<Schemes>()
    const restored = new DefinitionRegistry()
    await restoreProject(project, {
      editor: target,
      creationContext: { onControlsChanged: () => {}, getModuleDefinition: (id) => restored.get(id) },
      setNodePosition: () => {},
      clearDefinitions: () => restored.clear(),
      registerDefinition: (item) => restored.add(item),
      assignNodeToDefinition: (definitionId, nodeId) => restored.assignNode(definitionId, nodeId),
    })
    expect(restored.get(functionDefinition.id)?.resultType).toBe('number')
    expect(target.getNode(inputs.id)).toBeInstanceOf(FunctionInputsNode)
    expect(target.getNode(output.id)).toBeInstanceOf(FunctionOutputNode)
    expect((target.getNode(output.id) as FunctionOutputNode).inputs.result?.socket.name).toBe('number')
    const restoredCall = target.getNode(call.id) as FunctionCallNode
    expect(restoredCall).toBeInstanceOf(FunctionCallNode)
    expect(restoredCall.outputs.value?.socket.name).toBe('number')
    expect(restoredCall.getArguments()['x-id']).toBe(99)
    expect(target.getConnections().map((connection) => connection.id).sort()).toEqual(source.getConnections().map((connection) => connection.id).sort())
  })

  it('round-trips a nested Function Call in a Function scope, including a forward definition reference', async () => {
    const source = new NodeEditor<Schemes>()
    const registry = new DefinitionRegistry()
    const outer = { id: 'fn-outer', kind: 'function' as const, name: 'outer', inputsNodeId: 'outer-in', outputNodeId: 'outer-out', parameters: [], resultType: 'number' as const }
    const inner = { id: 'fn-inner', kind: 'function' as const, name: 'inner', inputsNodeId: 'inner-in', outputNodeId: 'inner-out', parameters: [{ id: 'x', name: 'x', type: 'number' as const, default: 2 }], resultType: 'number' as const }
    registry.add(outer); registry.add(inner)
    const outerInputs = new FunctionInputsNode(); outerInputs.id = outer.inputsNodeId
    const outerOutput = new FunctionOutputNode('number'); outerOutput.id = outer.outputNodeId
    const nested = new FunctionCallNode(inner, { definitionId: inner.id, arguments: { x: 7 } }); nested.id = 'nested-call'
    const innerInputs = new FunctionInputsNode(inner.parameters); innerInputs.id = inner.inputsNodeId
    const innerOutput = new FunctionOutputNode('number'); innerOutput.id = inner.outputNodeId
    const innerValue = new NumberNode({ value: 2, name: 'two' }); innerValue.id = 'inner-value'
    for (const node of [outerInputs, outerOutput, nested, innerInputs, innerOutput, innerValue]) await source.addNode(node)
    registry.assignNode(outer.id, nested.id)
    registry.assignNode(inner.id, innerValue.id)
    await source.addConnection(new ClassicPreset.Connection(nested, 'value', outerOutput, 'result') as Schemes['Connection'])
    await source.addConnection(new ClassicPreset.Connection(innerValue, 'value', innerOutput, 'result') as Schemes['Connection'])

    const project = parseScadletProject(serializeProject(serializeOptions(source, registry)))
    expect(project.definitions[0]?.graph.nodes.find((node) => node.id === nested.id)).toMatchObject({
      type: 'function-call', parameters: { definitionId: inner.id, arguments: { x: 7 } },
    })
    const target = new NodeEditor<Schemes>()
    const restored = new DefinitionRegistry()
    await restoreProject(project, {
      editor: target,
      creationContext: { onControlsChanged: () => {} },
      setNodePosition: () => {}, clearDefinitions: () => restored.clear(), registerDefinition: (item) => restored.add(item),
      assignNodeToDefinition: (definitionId, nodeId) => restored.assignNode(definitionId, nodeId),
    })
    expect(restored.scopeOf(nested.id)).toBe(outer.id)
    expect(target.getNode(nested.id)).toBeInstanceOf(FunctionCallNode)
    expect((target.getNode(nested.id) as FunctionCallNode).getArguments()).toEqual({ x: 7 })
  })

  it('round-trips Boolean- and Vector3-result Functions', async () => {
    const scenarios = [
      { type: 'boolean' as const, node: new BooleanNode({ value: true, name: 'flag' }), outputKey: 'value' as const },
      { type: 'vector3' as const, node: new Vector3Node({ x: 1, y: 2, z: 3, name: 'v' }), outputKey: 'value' as const },
    ]
    for (const { type, node, outputKey } of scenarios) {
      const source = new NodeEditor<Schemes>()
      const registry = new DefinitionRegistry()
      const definition = { id: `fn-${type}`, kind: 'function' as const, name: `returns_${type}`, inputsNodeId: `${type}-inputs`, outputNodeId: `${type}-output`, parameters: [] }
      registry.add({ ...definition, resultType: type })
      const inputs = new FunctionInputsNode(); inputs.id = definition.inputsNodeId
      const output = new FunctionOutputNode(type); output.id = definition.outputNodeId
      for (const item of [inputs, output, node]) await source.addNode(item)
      registry.assignNode(definition.id, node.id)
      await source.addConnection(new ClassicPreset.Connection(node, outputKey, output, 'result') as Schemes['Connection'])

      const project = parseScadletProject(serializeProject(serializeOptions(source, registry)))
      const definitionDto = project.definitions[0]!
      if (definitionDto.kind !== 'function') throw new Error('unreachable')
      expect(definitionDto.resultType).toBe(type)

      const target = new NodeEditor<Schemes>()
      const restored = new DefinitionRegistry()
      await restoreProject(project, {
        editor: target,
        creationContext: { onControlsChanged: () => {} },
        setNodePosition: () => {}, clearDefinitions: () => restored.clear(), registerDefinition: (item) => restored.add(item),
      })
      expect(restored.get(definition.id)?.resultType).toBe(type)
      expect((target.getNode(output.id) as FunctionOutputNode).inputs.result?.socket.name).toBe(type)
    }
  })

  it('round-trips an unresolved Function as a valid draft with no Output connection', async () => {
    const source = new NodeEditor<Schemes>()
    const registry = new DefinitionRegistry()
    const draft = { id: 'fn-draft', kind: 'function' as const, name: 'draft', inputsNodeId: 'draft-inputs', outputNodeId: 'draft-output', parameters: [] }
    registry.add(draft)
    const inputs = new FunctionInputsNode(); inputs.id = draft.inputsNodeId
    const output = new FunctionOutputNode(); output.id = draft.outputNodeId
    await source.addNode(inputs); await source.addNode(output)

    const project = parseScadletProject(serializeProject(serializeOptions(source, registry)))
    const definitionDto = project.definitions[0]!
    if (definitionDto.kind !== 'function') throw new Error('unreachable')
    expect(definitionDto.resultType).toBeUndefined()

    const target = new NodeEditor<Schemes>()
    const restored = new DefinitionRegistry()
    await restoreProject(project, {
      editor: target,
      creationContext: { onControlsChanged: () => {} },
      setNodePosition: () => {}, clearDefinitions: () => restored.clear(), registerDefinition: (item) => restored.add(item),
    })
    expect(restored.get(draft.id)?.resultType).toBeUndefined()
    expect((target.getNode(output.id) as FunctionOutputNode).inputs.result?.socket.name).toBe('unresolved')
  })

  it('rejects a Geometry node inside a Function definition graph', () => {
    const raw = {
      format: 'scadlet', version: 5, metadata: { name: 'Bad' },
      graph: { nodes: [], connections: [] },
      definitions: [{
        id: 'fn-1', kind: 'function', name: 'bad', interface: { inputs: 'in', output: 'out' }, parameters: [],
        graph: { nodes: [
          { id: 'in', type: 'function-inputs', position: { x: 0, y: 0 }, parameters: {} },
          { id: 'out', type: 'function-output', position: { x: 0, y: 0 }, parameters: {} },
          { id: 'cube-1', type: 'cube', position: { x: 0, y: 0 }, parameters: {} },
        ], connections: [] },
      }],
      editor: { viewport: { x: 0, y: 0, zoom: 1 } }, viewer: { camera },
    }
    expect(() => parseScadletProject(raw)).toThrow(ScadletProjectError)
    expect(() => parseScadletProject(raw)).toThrow(/not a supported node type inside a Function/)
  })

  it('rejects a Module Call inside a Function definition graph', () => {
    const raw = {
      format: 'scadlet', version: 5, metadata: { name: 'Bad' },
      graph: { nodes: [], connections: [] },
      definitions: [{
        id: 'fn-1', kind: 'function', name: 'bad', interface: { inputs: 'in', output: 'out' }, parameters: [],
        graph: { nodes: [
          { id: 'in', type: 'function-inputs', position: { x: 0, y: 0 }, parameters: {} },
          { id: 'out', type: 'function-output', position: { x: 0, y: 0 }, parameters: {} },
          { id: 'call-1', type: 'module-call', position: { x: 0, y: 0 }, parameters: { definitionId: 'mod-1' } },
        ], connections: [] },
      }],
      editor: { viewport: { x: 0, y: 0, zoom: 1 } }, viewer: { camera },
    }
    expect(() => parseScadletProject(raw)).toThrow('not supported inside a Function definition')
  })

  it('rejects a cross-scope wire from a Function graph into Main', () => {
    const raw = {
      format: 'scadlet', version: 5, metadata: { name: 'Bad' },
      graph: { nodes: [{ id: 'n1', type: 'number', position: { x: 0, y: 0 }, parameters: { value: 1 } }], connections: [
        { id: 'c1', source: 'in', sourceOutput: 'parameter:x-id', target: 'n1', targetInput: 'x' },
      ] },
      definitions: [{
        id: 'fn-1', kind: 'function', name: 'bad', interface: { inputs: 'in', output: 'out' },
        parameters: [{ id: 'x-id', name: 'x', type: 'number', default: 1 }],
        graph: { nodes: [
          { id: 'in', type: 'function-inputs', position: { x: 0, y: 0 }, parameters: {} },
          { id: 'out', type: 'function-output', position: { x: 0, y: 0 }, parameters: {} },
        ], connections: [] },
      }],
      editor: { viewport: { x: 0, y: 0, zoom: 1 } }, viewer: { camera },
    }
    expect(() => parseScadletProject(raw)).toThrow(/missing (source|target) node|unknown (source|target) port/)
  })

  it('restores an existing disconnected Function Call referencing an unresolved Function draft', () => {
    const raw = {
      format: 'scadlet', version: 5, metadata: { name: 'Bad' },
      graph: { nodes: [{ id: 'call-1', type: 'function-call', position: { x: 0, y: 0 }, parameters: { definitionId: 'fn-1' } }], connections: [] },
      definitions: [{
        id: 'fn-1', kind: 'function', name: 'unresolved', interface: { inputs: 'in', output: 'out' }, parameters: [],
        graph: { nodes: [
          { id: 'in', type: 'function-inputs', position: { x: 0, y: 0 }, parameters: {} },
          { id: 'out', type: 'function-output', position: { x: 0, y: 0 }, parameters: {} },
        ], connections: [] },
      }],
      editor: { viewport: { x: 0, y: 0, zoom: 1 } }, viewer: { camera },
    }
    expect(parseScadletProject(raw).graph.nodes).toHaveLength(1)
    const withOutgoingWire = {
      ...raw,
      graph: {
        nodes: [...raw.graph.nodes, { id: 'add-1', type: 'add', position: { x: 100, y: 0 }, parameters: { a: 0, b: 0 } }],
        connections: [{ id: 'bad-wire', source: 'call-1', sourceOutput: 'value', target: 'add-1', targetInput: 'a' }],
      },
    }
    expect(() => parseScadletProject(withOutgoingWire)).toThrow(/unknown output cannot connect to number input/)
  })

  it('validates effective mutual Function recursion and the same disconnected dead Call in schema v6', () => {
    const definition = (id: string, name: string, callee: string, connected: boolean) => ({
      id, kind: 'function', name, interface: { inputs: `${id}-in`, output: `${id}-out` }, parameters: [], resultType: 'number',
      graph: { nodes: [
        { id: `${id}-in`, type: 'function-inputs', position: { x: 0, y: 0 }, parameters: {} },
        { id: `${id}-out`, type: 'function-output', position: { x: 200, y: 0 }, parameters: {} },
        { id: `${id}-call`, type: 'function-call', position: { x: 100, y: 0 }, parameters: { definitionId: callee, arguments: {} } },
        ...(!connected ? [{ id: `${id}-value`, type: 'number', position: { x: 100, y: 100 }, parameters: { value: 1 } }] : []),
      ], connections: [{
        id: `${id}-result`, source: connected ? `${id}-call` : `${id}-value`, sourceOutput: 'value', target: `${id}-out`, targetInput: 'result',
      }] },
    })
    const project = (deadSecondCall: boolean) => ({
      format: 'scadlet', version: 6, metadata: { name: 'Cycles' }, graph: { nodes: [], connections: [] },
      definitions: [definition('a', 'a', 'b', true), definition('b', 'b', 'a', !deadSecondCall)],
      editor: { viewport: { x: 0, y: 0, zoom: 1 } }, viewer: { camera },
    })
    const recursive = parseScadletProject(project(false))
    expect(recursive.version).toBe(7)
    expect(recursive.definitions).toHaveLength(2)
    expect(recursive.definitions.flatMap((item) => item.graph.connections)).toHaveLength(2)
    expect(parseScadletProject(project(true)).definitions).toHaveLength(2)
  })

  it('rejects a Function Output claiming a resolved type with zero connections, and vice versa', () => {
    const noConnection = {
      format: 'scadlet', version: 5, metadata: { name: 'Bad' },
      graph: { nodes: [], connections: [] },
      definitions: [{
        id: 'fn-1', kind: 'function', name: 'bad', interface: { inputs: 'in', output: 'out' }, parameters: [], resultType: 'number',
        graph: { nodes: [
          { id: 'in', type: 'function-inputs', position: { x: 0, y: 0 }, parameters: {} },
          { id: 'out', type: 'function-output', position: { x: 0, y: 0 }, parameters: {} },
        ], connections: [] },
      }],
      editor: { viewport: { x: 0, y: 0, zoom: 1 } }, viewer: { camera },
    }
    expect(() => parseScadletProject(noConnection)).toThrow(/exactly one connection into Function Output/)
  })

  it('no duplicate ports appear after repeated restore of a resolved Function', async () => {
    const source = new NodeEditor<Schemes>()
    const registry = new DefinitionRegistry()
    registry.add({ ...functionDefinition, resultType: 'number' })
    const inputs = new FunctionInputsNode(functionDefinition.parameters); inputs.id = functionDefinition.inputsNodeId
    const output = new FunctionOutputNode('number'); output.id = functionDefinition.outputNodeId
    const numberNode = new NumberNode({ value: 2, name: 'two' }); numberNode.id = 'literal-2'
    for (const node of [inputs, output, numberNode]) await source.addNode(node)
    registry.assignNode(functionDefinition.id, numberNode.id)
    await source.addConnection(new ClassicPreset.Connection(numberNode, 'value', output, 'result') as Schemes['Connection'])

    const project = parseScadletProject(serializeProject(serializeOptions(source, registry)))
    for (let i = 0; i < 2; i += 1) {
      const target = new NodeEditor<Schemes>()
      const restored = new DefinitionRegistry()
      await restoreProject(project, {
        editor: target,
        creationContext: { onControlsChanged: () => {} },
        setNodePosition: () => {}, clearDefinitions: () => restored.clear(), registerDefinition: (item) => restored.add(item),
      })
      const restoredInputs = target.getNode(inputs.id) as FunctionInputsNode
      expect(Object.keys(restoredInputs.outputs)).toEqual(['parameter:x-id'])
    }
  })

  it('round-trips direct and mutual recursive v6 Calls repeatedly without duplicate ports or wires', async () => {
    const project = parseScadletProject(recursiveFixture)
    const target = new NodeEditor<Schemes>()
    const restored = new DefinitionRegistry()
    const options = {
      editor: target,
      creationContext: { onControlsChanged: () => {}, getModuleDefinition: (id: string) => restored.get(id) },
      setNodePosition: () => {}, clearDefinitions: () => restored.clear(), registerDefinition: (item: Parameters<DefinitionRegistry['add']>[0]) => restored.add(item),
      assignNodeToDefinition: (definitionId: string, nodeId: string) => restored.assignNode(definitionId, nodeId),
    }
    await restoreProject(project, options)
    await restoreProject(project, options)

    expect(target.getConnections()).toHaveLength(27)
    for (const id of ['factorial-self', 'odd-even-call', 'even-odd-call']) {
      const call = target.getNode(id) as FunctionCallNode
      expect(call).toBeInstanceOf(FunctionCallNode)
      expect(Object.keys(call.inputs)).toEqual(['parameter:n'])
      expect(call.getArguments()).toHaveProperty('n')
    }
    const roundTrip = parseScadletProject(serializeProject(serializeOptions(target, restored)))
    expect(roundTrip.version).toBe(7)
    expect(roundTrip.definitions.flatMap((definition) => definition.graph.connections)).toHaveLength(26)
    expect(roundTrip.graph.connections).toHaveLength(1)
  })
})

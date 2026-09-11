import { NodeEditor } from 'rete'
import { DataflowEngine } from 'rete-engine'
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { DefinitionRegistry, moduleGeometryInputPortId } from '../editor/definitions'
import { evaluateOpenSCAD } from '../editor/evaluate'
import { ModuleInputsNode, ModuleOutputNode } from '../editor/nodes/module-interface-nodes'
import { CubeNode } from '../editor/nodes/cube-node'
import { ModuleCallNode } from '../editor/nodes/module-call-node'
import { TranslateNode } from '../editor/nodes/translate-node'
import { ClassicPreset } from 'rete'
import type { Schemes } from '../editor/schemes'
import { restoreProject } from './restore'
import { serializeProject } from './serialize'
import { parseScadletProject, ScadletProjectError } from './validate'

const definition = { id: 'definition-wheel', kind: 'module' as const, name: 'wheel', inputsNodeId: 'wheel-inputs', outputNodeId: 'wheel-output', geometryInputs: [{ id: 'wheel-geometry-1', name: 'Geometry 1' }] }
const camera = { position: [0, 0, 0] as [number, number, number], target: [0, 0, 0] as [number, number, number] }
const recursiveModulesFixture = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../docs/examples/recursive-modules-v6.scadlet'), 'utf8'))

describe('v3 Module definition persistence', () => {
  it('round-trips a separately-owned Module graph with stable interface identities and positions', async () => {
    const source = new NodeEditor<Schemes>()
    const inputs = new ModuleInputsNode(); inputs.id = definition.inputsNodeId
    const output = new ModuleOutputNode(); output.id = definition.outputNodeId
    await source.addNode(inputs)
    await source.addNode(output)

    const project = parseScadletProject(serializeProject({
      editor: source,
      metadata: { name: 'Modules' },
      getNodePosition: (id) => id === inputs.id ? { x: 10, y: 20 } : { x: 300, y: 20 },
      viewport: { x: 3, y: 4, k: 1.2 },
      viewerCamera: camera,
      definitions: [definition],
      getNodeScope: () => definition.id,
      now: () => '2026-09-05T00:00:00.000Z',
    }))

    expect(project.version).toBe(6)
    expect(project.graph.nodes).toEqual([])
    expect(project.definitions).toHaveLength(1)
    expect(project.definitions[0]).toMatchObject({ id: definition.id, kind: 'module', name: 'wheel', interface: { inputs: inputs.id, output: output.id } })
    expect(project.definitions[0]?.graph.nodes.map((node) => node.position)).toEqual([{ x: 10, y: 20 }, { x: 300, y: 20 }])

    const target = new NodeEditor<Schemes>()
    const registry = new DefinitionRegistry()
    const positions: Record<string, { x: number; y: number }> = {}
    await restoreProject(project, {
      editor: target,
      creationContext: { onControlsChanged: () => {} },
      setNodePosition: (id, position) => { positions[id] = position },
      clearDefinitions: () => registry.clear(),
      registerDefinition: (record) => registry.add(record),
    })
    expect(registry.get(definition.id)).toMatchObject(definition)
    expect(target.getNode(inputs.id)).toBeInstanceOf(ModuleInputsNode)
    expect(target.getNode(output.id)).toBeInstanceOf(ModuleOutputNode)
    expect(positions).toEqual({ 'wheel-inputs': { x: 10, y: 20 }, 'wheel-output': { x: 300, y: 20 } })
  })

  it('migrates a v2 project to an empty definition registry without changing Main', () => {
    const project = parseScadletProject({
      format: 'scadlet', version: 2, metadata: { name: 'Old' },
      graph: { nodes: [], connections: [] },
      editor: { viewport: { x: 12, y: -4, zoom: 1.3 } }, viewer: { camera },
    })
    expect(project.version).toBe(6)
    expect(project.definitions).toEqual([])
    expect(project.editor.viewport).toEqual({ x: 12, y: -4, zoom: 1.3 })
  })

  it('round-trips ordinary Module-owned nodes, their body connection, and a stable-ID Main call', async () => {
    const source = new NodeEditor<Schemes>()
    const registry = new DefinitionRegistry()
    registry.add(definition)
    const inputs = new ModuleInputsNode([], definition.geometryInputs); inputs.id = definition.inputsNodeId
    const output = new ModuleOutputNode(); output.id = definition.outputNodeId
    const cube = new CubeNode(); cube.id = 'wheel-cube'
    const call = new ModuleCallNode(definition.id, definition.name); call.id = 'main-wheel-call'
    for (const node of [inputs, output, cube, call]) await source.addNode(node)
    registry.assignNode(definition.id, cube.id)
    await source.addConnection(new ClassicPreset.Connection(cube, 'geometry', output, 'geometry') as Schemes['Connection'])

    const project = parseScadletProject(serializeProject({
      editor: source, metadata: { name: 'Wheel' }, getNodePosition: () => ({ x: 0, y: 0 }),
      viewport: { x: 0, y: 0, k: 1 }, viewerCamera: camera, definitions: [definition], getNodeScope: (id) => registry.scopeOf(id),
    }))
    expect(project.graph.nodes).toMatchObject([{ id: call.id, type: 'module-call', parameters: { definitionId: definition.id } }])
    expect(project.definitions[0]?.graph.nodes.map((node) => node.id)).toEqual([inputs.id, output.id, cube.id])
    expect(project.definitions[0]?.graph.connections).toMatchObject([{ source: cube.id, target: output.id, targetInput: 'geometry' }])

    const target = new NodeEditor<Schemes>()
    const restored = new DefinitionRegistry()
    await restoreProject(project, {
      editor: target,
      creationContext: { onControlsChanged: () => {}, getModuleDefinition: (id) => restored.get(id) },
      setNodePosition: () => {}, clearDefinitions: () => restored.clear(), registerDefinition: (item) => restored.add(item),
      assignNodeToDefinition: (definitionId, nodeId) => restored.assignNode(definitionId, nodeId),
    })
    expect(restored.scopeOf(cube.id)).toBe(definition.id)
    expect(target.getNode(call.id)).toBeInstanceOf(ModuleCallNode)
  })

  it('round-trips structural children connections without serializing them as parameters', async () => {
    const source = new NodeEditor<Schemes>()
    const registry = new DefinitionRegistry(); registry.add(definition)
    const childKey = moduleGeometryInputPortId(definition.geometryInputs[0]!.id)
    const inputs = new ModuleInputsNode([], definition.geometryInputs); inputs.id = definition.inputsNodeId
    const output = new ModuleOutputNode(); output.id = definition.outputNodeId
    const translate = new TranslateNode({ z: 15 }); translate.id = 'wheel-translate'
    const call = new ModuleCallNode(definition); call.id = 'main-wheel-call'
    const cube = new CubeNode(); cube.id = 'main-child-cube'
    for (const node of [inputs, output, translate, call, cube]) await source.addNode(node)
    registry.assignNode(definition.id, translate.id)
    await source.addConnection(new ClassicPreset.Connection(inputs, childKey, translate, 'geometry') as Schemes['Connection'])
    await source.addConnection(new ClassicPreset.Connection(translate, 'geometry', output, 'geometry') as Schemes['Connection'])
    await source.addConnection(new ClassicPreset.Connection(cube, 'geometry', call, childKey) as Schemes['Connection'])

    const project = parseScadletProject(serializeProject({
      editor: source, metadata: { name: 'Children' }, getNodePosition: () => ({ x: 0, y: 0 }),
      viewport: { x: 0, y: 0, k: 1 }, viewerCamera: camera, definitions: registry.list(), getNodeScope: (id) => registry.scopeOf(id),
    }))
    expect(project.definitions[0]?.parameters).toEqual([])
    expect(project.definitions[0]?.graph.connections.some((connection) => connection.sourceOutput === childKey)).toBe(true)
    expect(project.graph.connections.some((connection) => connection.targetInput === childKey)).toBe(true)

    const target = new NodeEditor<Schemes>()
    const engine = new DataflowEngine<Schemes>((node) => ({ inputs: () => Object.keys(node.inputs), outputs: () => Object.keys(node.outputs) }))
    target.use(engine)
    const restored = new DefinitionRegistry()
    await restoreProject(project, {
      editor: target,
      creationContext: { onControlsChanged: () => {}, getModuleDefinition: (id) => restored.get(id) },
      setNodePosition: () => {}, clearDefinitions: () => restored.clear(), registerDefinition: (item) => restored.add(item),
      assignNodeToDefinition: (definitionId, nodeId) => restored.assignNode(definitionId, nodeId),
    })
    expect(Object.keys((target.getNode(inputs.id) as ModuleInputsNode).outputs)).toEqual([childKey])
    expect(Object.keys((target.getNode(call.id) as ModuleCallNode).inputs)).toEqual([childKey])
    expect(target.getConnections()).toHaveLength(3)
    await expect(evaluateOpenSCAD(target, engine, undefined, restored)).resolves.toContain('wheel() {\n  cube(10);\n}')
  })

  it('rejects a dangling Call but accepts a valid nested Module Call in persisted graphs', () => {
    const base = {
      format: 'scadlet', version: 3, metadata: { name: 'Broken' },
      graph: { nodes: [{ id: 'call', type: 'module-call', position: { x: 0, y: 0 }, parameters: { definitionId: 'missing' } }], connections: [] },
      definitions: [{
        id: definition.id, kind: definition.kind, name: definition.name,
        interface: { inputs: definition.inputsNodeId, output: definition.outputNodeId },
        graph: {
          nodes: [
            { id: definition.inputsNodeId, type: 'module-inputs', position: { x: 0, y: 0 }, parameters: {} },
            { id: definition.outputNodeId, type: 'module-output', position: { x: 200, y: 0 }, parameters: {} },
          ], connections: [],
        },
      }], editor: { viewport: { x: 0, y: 0, zoom: 1 } }, viewer: { camera },
    }
    expect(() => parseScadletProject(base)).toThrow('references unknown Module definition')
    const nested = structuredClone(base)
    nested.graph.nodes = []
    nested.definitions[0].graph.nodes.push({ id: 'nested', type: 'module-call', position: { x: 30, y: 0 }, parameters: { definitionId: definition.id } })
    expect(parseScadletProject(nested).definitions[0]?.graph.nodes.find((node) => node.id === 'nested')).toMatchObject({ type: 'module-call', parameters: { definitionId: definition.id } })
  })

  it('accepts effective and dead persisted Module recursion without changing schema v6', () => {
    const module = (id: string, name: string, callee: string, connected: boolean) => ({
      id, kind: 'module', name, interface: { inputs: `${id}-in`, output: `${id}-out` }, parameters: [], geometryInputs: [],
      graph: {
        nodes: [
          { id: `${id}-in`, type: 'module-inputs', position: { x: 0, y: 0 }, parameters: {} },
          { id: `${id}-out`, type: 'module-output', position: { x: 200, y: 0 }, parameters: {} },
          { id: `${id}-call`, type: 'module-call', position: { x: 100, y: 0 }, parameters: { definitionId: callee, arguments: {} } },
        ],
        connections: connected ? [{ id: `${id}-body`, source: `${id}-call`, sourceOutput: 'geometry', target: `${id}-out`, targetInput: 'geometry' }] : [],
      },
    })
    const dead = {
      format: 'scadlet', version: 5, metadata: { name: 'Dead Module draft' }, graph: { nodes: [], connections: [] },
      definitions: [module('a', 'a', 'b', true), module('b', 'b', 'a', false)],
      editor: { viewport: { x: 0, y: 0, zoom: 1 } }, viewer: { camera },
    }
    expect(parseScadletProject(dead).definitions).toHaveLength(2)
    const recursive = structuredClone(dead)
    recursive.definitions[1].graph.connections.push({ id: 'b-body', source: 'b-call', sourceOutput: 'geometry', target: 'b-out', targetInput: 'geometry' })
    const parsed = parseScadletProject(recursive)
    expect(parsed.version).toBe(6)
    expect(parsed.definitions.flatMap((item) => item.graph.connections)).toHaveLength(2)
  })

  it('round-trips recursive Module SCCs repeatedly without duplicate dynamic ports or wires', async () => {
    const project = parseScadletProject(recursiveModulesFixture)
    const target = new NodeEditor<Schemes>()
    const engine = new DataflowEngine<Schemes>((node) => ({ inputs: () => Object.keys(node.inputs), outputs: () => Object.keys(node.outputs) }))
    target.use(engine)
    const restored = new DefinitionRegistry()
    const options = {
      editor: target,
      creationContext: { onControlsChanged: () => {}, getModuleDefinition: (id: string) => restored.get(id) },
      setNodePosition: () => {}, clearDefinitions: () => restored.clear(), registerDefinition: (item: Parameters<DefinitionRegistry['add']>[0]) => restored.add(item),
      assignNodeToDefinition: (definitionId: string, nodeId: string) => restored.assignNode(definitionId, nodeId),
    }
    await restoreProject(project, options)
    await restoreProject(project, options)

    expect(target.getConnections()).toHaveLength(34)
    for (const id of ['main-stack', 'stack-self']) {
      const call = target.getNode(id) as ModuleCallNode
      expect(call).toBeInstanceOf(ModuleCallNode)
      expect(Object.keys(call.inputs)).toEqual(['geometry:profile', 'geometry:layer', 'parameter:n'])
      expect(call.getArguments()).toEqual({ n: id === 'main-stack' ? 4 : 1 })
    }
    const source = await evaluateOpenSCAD(target, engine, undefined, restored)
    expect(source.indexOf('function previous')).toBeLessThan(source.indexOf('module stack'))
    expect(source.indexOf('module stack')).toBeLessThan(source.indexOf('module pong'))
    expect(source.indexOf('module pong')).toBeLessThan(source.indexOf('module ping'))
    expect(source).toContain('stack(n = previous(n = n))')
    expect(source).toContain('pong(n = previous(n = n))')
    expect(source).toContain('ping(n = previous(n = n))')
    expect(source).toContain('children(1);')
    expect(source).toContain('union() {}')

    const roundTrip = parseScadletProject(serializeProject({
      editor: target, metadata: { name: 'Recursive Modules' }, getNodePosition: () => ({ x: 0, y: 0 }),
      viewport: { x: 0, y: 0, k: 1 }, viewerCamera: camera, definitions: restored.list(), getNodeScope: (id) => restored.scopeOf(id),
    }))
    expect(roundTrip.version).toBe(6)
    expect(roundTrip.graph.connections).toHaveLength(1)
    expect(roundTrip.definitions.flatMap((item) => item.graph.connections)).toHaveLength(33)
  })

  it.each([
    ['missing Inputs', { interface: { inputs: 'missing', output: 'wheel-output' } }],
    ['missing Output', { interface: { inputs: 'wheel-inputs', output: 'missing' } }],
    ['invalid name', { name: 'wheel-size' }],
  ])('rejects %s', (_label, change) => {
    const raw = {
      format: 'scadlet', version: 3, metadata: { name: 'Broken' }, graph: { nodes: [], connections: [] },
      definitions: [{
        ...definition, ...change,
        graph: {
          nodes: [
            { id: 'wheel-inputs', type: 'module-inputs', position: { x: 0, y: 0 }, parameters: {} },
            { id: 'wheel-output', type: 'module-output', position: { x: 200, y: 0 }, parameters: {} },
          ], connections: [],
        },
      }],
      editor: { viewport: { x: 0, y: 0, zoom: 1 } }, viewer: { camera },
    }
    expect(() => parseScadletProject(raw)).toThrow(ScadletProjectError)
  })

  it('rejects duplicate definition identities and duplicate interface roles', () => {
    const moduleGraph = {
      nodes: [
        { id: 'wheel-inputs', type: 'module-inputs', position: { x: 0, y: 0 }, parameters: {} },
        { id: 'wheel-inputs-extra', type: 'module-inputs', position: { x: 40, y: 0 }, parameters: {} },
        { id: 'wheel-output', type: 'module-output', position: { x: 200, y: 0 }, parameters: {} },
      ], connections: [],
    }
    const base = {
      format: 'scadlet', version: 3, metadata: { name: 'Broken' }, graph: { nodes: [], connections: [] },
      definitions: [{ ...definition, graph: moduleGraph }],
      editor: { viewport: { x: 0, y: 0, zoom: 1 } }, viewer: { camera },
    }
    expect(() => parseScadletProject(base)).toThrow(ScadletProjectError)
    const withoutExtra = { ...moduleGraph, nodes: moduleGraph.nodes.filter((node) => node.id !== 'wheel-inputs-extra') }
    expect(() => parseScadletProject({ ...base, definitions: [
      { ...definition, graph: withoutExtra },
      { ...definition, name: 'axle', graph: withoutExtra },
    ] })).toThrow(ScadletProjectError)
  })
})

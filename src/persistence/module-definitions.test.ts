import { NodeEditor } from 'rete'
import { DataflowEngine } from 'rete-engine'
import { describe, expect, it } from 'vitest'

import { DefinitionRegistry, MODULE_CHILD_PORT_ID } from '../editor/definitions'
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

const definition = { id: 'definition-wheel', kind: 'module' as const, name: 'wheel', inputsNodeId: 'wheel-inputs', outputNodeId: 'wheel-output' }
const camera = { position: [0, 0, 0] as [number, number, number], target: [0, 0, 0] as [number, number, number] }

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

    expect(project.version).toBe(3)
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
    expect(project.version).toBe(3)
    expect(project.definitions).toEqual([])
    expect(project.editor.viewport).toEqual({ x: 12, y: -4, zoom: 1.3 })
  })

  it('round-trips ordinary Module-owned nodes, their body connection, and a stable-ID Main call', async () => {
    const source = new NodeEditor<Schemes>()
    const registry = new DefinitionRegistry()
    registry.add(definition)
    const inputs = new ModuleInputsNode(); inputs.id = definition.inputsNodeId
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
    const inputs = new ModuleInputsNode(); inputs.id = definition.inputsNodeId
    const output = new ModuleOutputNode(); output.id = definition.outputNodeId
    const translate = new TranslateNode({ z: 15 }); translate.id = 'wheel-translate'
    const call = new ModuleCallNode(definition); call.id = 'main-wheel-call'
    const cube = new CubeNode(); cube.id = 'main-child-cube'
    for (const node of [inputs, output, translate, call, cube]) await source.addNode(node)
    registry.assignNode(definition.id, translate.id)
    await source.addConnection(new ClassicPreset.Connection(inputs, MODULE_CHILD_PORT_ID, translate, 'geometry') as Schemes['Connection'])
    await source.addConnection(new ClassicPreset.Connection(translate, 'geometry', output, 'geometry') as Schemes['Connection'])
    await source.addConnection(new ClassicPreset.Connection(cube, 'geometry', call, MODULE_CHILD_PORT_ID) as Schemes['Connection'])

    const project = parseScadletProject(serializeProject({
      editor: source, metadata: { name: 'Children' }, getNodePosition: () => ({ x: 0, y: 0 }),
      viewport: { x: 0, y: 0, k: 1 }, viewerCamera: camera, definitions: registry.list(), getNodeScope: (id) => registry.scopeOf(id),
    }))
    expect(project.definitions[0]?.parameters).toEqual([])
    expect(project.definitions[0]?.graph.connections.some((connection) => connection.sourceOutput === MODULE_CHILD_PORT_ID)).toBe(true)
    expect(project.graph.connections.some((connection) => connection.targetInput === MODULE_CHILD_PORT_ID)).toBe(true)

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
    expect(Object.keys((target.getNode(inputs.id) as ModuleInputsNode).outputs)).toEqual([MODULE_CHILD_PORT_ID])
    expect(Object.keys((target.getNode(call.id) as ModuleCallNode).inputs)).toEqual([MODULE_CHILD_PORT_ID])
    expect(target.getConnections()).toHaveLength(3)
    await expect(evaluateOpenSCAD(target, engine, undefined, restored)).resolves.toContain('wheel() {\n  cube(10);\n}')
  })

  it('rejects a dangling Main Call and a nested Module Call in persisted graphs', () => {
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
    expect(() => parseScadletProject(nested)).toThrow('belongs in Main')
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

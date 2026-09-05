import { NodeEditor } from 'rete'
import { describe, expect, it } from 'vitest'

import { DefinitionRegistry } from '../editor/definitions'
import { ModuleInputsNode, ModuleOutputNode } from '../editor/nodes/module-interface-nodes'
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

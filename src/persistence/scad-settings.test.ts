import { NodeEditor } from 'rete'
import { DataflowEngine } from 'rete-engine'
import { describe, expect, it } from 'vitest'

import { DefinitionRegistry } from '../editor/definitions'
import { evaluateOpenSCAD } from '../editor/evaluate'
import type { Schemes } from '../editor/schemes'
import { restoreProject } from './restore'
import { serializeProject } from './serialize'
import { parseScadletProject } from './validate'

const CAMERA = { position: [80, 80, 60] as [number, number, number], target: [0, 0, 0] as [number, number, number] }

function project(version = 7): any {
  return {
    format: 'scadlet', version, metadata: { name: 'Scoped settings' },
    graph: {
      nodes: [
        { id: 'main-value', type: 'number', position: { x: 0, y: 0 }, parameters: { value: 50, name: 'Detail' } },
        { id: 'main-settings', type: 'scad-settings', position: { x: 200, y: 0 }, parameters: { fn: 30, fs: 1 } },
        { id: 'main-call', type: 'module-call', position: { x: 400, y: 0 }, parameters: { definitionId: 'part', arguments: {} } },
      ],
      connections: [{ id: 'main-fn', source: 'main-value', sourceOutput: 'value', target: 'main-settings', targetInput: 'fn' }],
    },
    definitions: [{
      id: 'part', kind: 'module', name: 'part', interface: { inputs: 'part-in', output: 'part-out' }, parameters: [], geometryInputs: [],
      graph: {
        nodes: [
          { id: 'part-in', type: 'module-inputs', position: { x: 0, y: 300 }, parameters: {} },
          { id: 'part-settings', type: 'scad-settings', position: { x: 200, y: 300 }, parameters: { fn: 12, fa: 6 } },
          { id: 'part-cube', type: 'cube', position: { x: 400, y: 300 }, parameters: { sizeRepresentation: 'scalar', sizeScalar: 10, sizeVector: { x: 10, y: 10, z: 10 }, size: 10 } },
          { id: 'part-out', type: 'module-output', position: { x: 600, y: 300 }, parameters: {} },
        ],
        connections: [{ id: 'part-body', source: 'part-cube', sourceOutput: 'geometry', target: 'part-out', targetInput: 'geometry' }],
      },
    }],
    editor: { viewport: { x: 0, y: 0, zoom: 1 } }, viewer: { camera: CAMERA },
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

describe('SCAD settings persistence', () => {
  it('restores settings, dynamic ports, fallbacks, connections, and generated scope placement', async () => {
    const { editor, engine, definitions } = await restore(project())
    const source = await evaluateOpenSCAD(editor, engine, undefined, definitions)
    expect(source).toContain('module part() {\n  $fn = 12;\n  $fa = 6;\n  cube(10);\n}')
    expect(source).toContain('$fn = 50;\n$fs = 1;\npart();')

    const saved = serializeProject({
      editor, metadata: { name: 'Scoped settings' }, getNodePosition: () => ({ x: 0, y: 0 }),
      viewport: { x: 0, y: 0, k: 1 }, viewerCamera: CAMERA, definitions: definitions.list(), getNodeScope: (id) => definitions.scopeOf(id),
      now: () => '2026-09-15T00:00:00.000Z',
    })
    expect(saved.version).toBe(8)
    expect(saved.graph.nodes.find((node) => node.id === 'main-settings')?.parameters).toEqual({ fn: 30, fs: 1 })
    expect(saved.definitions[0]?.graph.nodes.find((node) => node.id === 'part-settings')?.parameters).toEqual({ fn: 12, fa: 6 })
    expect(saved.graph.connections).toHaveLength(1)
  })

  it('migrates a legacy v6 project without settings to v8 unchanged', () => {
    const legacy = project(6)
    legacy.graph.nodes = legacy.graph.nodes.filter((node: { type: string }) => node.type !== 'scad-settings' && node.type !== 'number')
    legacy.graph.connections = []
    legacy.definitions[0]!.graph.nodes = legacy.definitions[0]!.graph.nodes.filter((node: { type: string }) => node.type !== 'scad-settings')
    const parsed = parseScadletProject(legacy)
    expect(parsed.version).toBe(8)
    expect(parsed.graph.nodes.map((node) => node.id)).toEqual(['main-call'])
  })

  it('rejects duplicate nodes, Function-scope nodes, inactive ports, and wrong socket types', () => {
    const duplicate = structuredClone(project())
    duplicate.graph.nodes.push({ id: 'other-settings', type: 'scad-settings', position: { x: 300, y: 0 }, parameters: {} })
    expect(() => parseScadletProject(duplicate)).toThrow('at most one SCAD settings node')

    const inFunction = structuredClone(project())
    const definition = inFunction.definitions[0]!
    definition.kind = 'function' as never
    delete (definition as { geometryInputs?: unknown }).geometryInputs
    ;(definition as unknown as { resultType?: string }).resultType = 'number'
    definition.graph.nodes = [
      { id: 'part-in', type: 'function-inputs', position: { x: 0, y: 0 }, parameters: {} },
      { id: 'part-settings', type: 'scad-settings', position: { x: 100, y: 0 }, parameters: { fn: 20 } },
      { id: 'part-number', type: 'number', position: { x: 200, y: 0 }, parameters: { value: 1, name: 'Number' } },
      { id: 'part-out', type: 'function-output', position: { x: 300, y: 0 }, parameters: {} },
    ]
    definition.graph.connections = [{ id: 'result', source: 'part-number', sourceOutput: 'value', target: 'part-out', targetInput: 'result' }]
    inFunction.graph.nodes = []
    inFunction.graph.connections = []
    expect(() => parseScadletProject(inFunction)).toThrow('not a supported node type inside a Function definition')

    const inactive = structuredClone(project())
    ;(inactive.graph.nodes.find((node: { id: string }) => node.id === 'main-settings')!.parameters as Record<string, number>).fn = undefined as never
    expect(() => parseScadletProject(inactive)).toThrow('unknown target port "fn"')

    const wrongType = structuredClone(project())
    wrongType.graph.nodes[0] = { id: 'main-value', type: 'boolean', position: { x: 0, y: 0 }, parameters: { value: true, name: 'Flag' } }
    expect(() => parseScadletProject(wrongType)).toThrow('boolean output cannot connect to number input')
  })
})

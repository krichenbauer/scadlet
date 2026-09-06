import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { NodeEditor } from 'rete'
import { DataflowEngine } from 'rete-engine'
import { describe, expect, it } from 'vitest'

import { DefinitionRegistry, moduleGeometryInputPortId, moduleParameterPortId } from '../editor/definitions'
import { evaluateOpenSCAD } from '../editor/evaluate'
import { ModuleCallNode } from '../editor/nodes/module-call-node'
import { ModuleInputsNode } from '../editor/nodes/module-interface-nodes'
import type { Schemes } from '../editor/schemes'
import { restoreProject } from './restore'
import { serializeProject } from './serialize'
import { parseScadletProject } from './validate'

const fixturePath = fileURLToPath(new URL('./fixtures/pre-phase4-module-parameters-v3.scadlet', import.meta.url))

function historicalProject() {
  // Static fixture based on the v3 writer immediately before Phase 4
  // (`git show 5dfedda:src/persistence/serialize.ts`), never the current
  // serializer. In particular, signatures live on definitions, while the
  // interface node deliberately has an empty parameter object.
  return parseScadletProject(JSON.parse(readFileSync(fixturePath, 'utf8')))
}

describe('historical v3 Module parameter persistence', () => {
  it('normalizes, restores, evaluates, and reserializes the pre-Phase-4 fixture without losing signature data', async () => {
    const project = historicalProject()
    const [definition] = project.definitions
    if (definition.kind !== 'module') throw new Error('Expected a Module definition fixture.')
    expect(definition).toMatchObject({
      id: 'definition-wheel', name: 'wheel',
      parameters: [
        { id: 'radius-id', name: 'radius', type: 'number', default: 12 },
        { id: 'center-id', name: 'centered', type: 'boolean', default: true },
        { id: 'offset-id', name: 'offset', type: 'vector3', default: [1, 2, 3] },
      ],
    })
    expect(project.graph.nodes.find((node) => node.id === 'main-wheel-call')?.parameters).toEqual({
      definitionId: 'definition-wheel',
      arguments: { 'radius-id': 19, 'center-id': false, 'offset-id': [8, 9, 10] },
    })

    const editor = new NodeEditor<Schemes>()
    const engine = new DataflowEngine<Schemes>((node) => ({ inputs: () => Object.keys(node.inputs), outputs: () => Object.keys(node.outputs) }))
    editor.use(engine)
    const registry = new DefinitionRegistry()
    const positions: Record<string, { x: number; y: number }> = {}
    await restoreProject(project, {
      editor,
      creationContext: { onControlsChanged: () => {}, getModuleDefinition: (id) => registry.get(id) },
      clearDefinitions: () => registry.clear(),
      registerDefinition: (item) => registry.add(item),
      assignNodeToDefinition: (definitionId, nodeId) => registry.assignNode(definitionId, nodeId),
      setNodePosition: (id, position) => { positions[id] = position },
    })

    const inputs = editor.getNode('wheel-inputs')
    const call = editor.getNode('main-wheel-call')
    expect(inputs).toBeInstanceOf(ModuleInputsNode)
    expect(call).toBeInstanceOf(ModuleCallNode)
    const geometryKey = moduleGeometryInputPortId(definition.geometryInputs[0]!.id)
    expect(Object.keys((inputs as ModuleInputsNode).outputs)).toEqual([geometryKey, ...definition.parameters.map((parameter) => moduleParameterPortId(parameter.id))])
    expect(Object.keys((call as ModuleCallNode).inputs)).toEqual([geometryKey, ...definition.parameters.map((parameter) => moduleParameterPortId(parameter.id))])
    expect(editor.getConnections().map((connection) => connection.id)).toEqual([
      'call-radius-wire', 'wheel-radius-wire', 'wheel-body-wire',
    ])
    expect(positions).toMatchObject({
      'wheel-inputs': { x: 320, y: -200 },
      'main-wheel-call': { x: 40, y: 60 },
    })
    await expect(evaluateOpenSCAD(editor, engine, undefined, registry)).resolves.toContain(
      'module wheel(radius = 12, centered = true, offset = [1, 2, 3]) {\n  sphere(r=radius);\n}\n\nwheel(radius = 31, centered = false, offset = [8, 9, 10]);',
    )

    const serialized = parseScadletProject(serializeProject({
      editor,
      metadata: project.metadata,
      getNodePosition: (id) => positions[id]!,
      viewport: { x: project.editor.viewport.x, y: project.editor.viewport.y, k: project.editor.viewport.zoom },
      viewerCamera: project.viewer.camera,
      definitions: registry.list(),
      getNodeScope: (id) => registry.scopeOf(id),
      now: () => '2026-09-05T10:00:00.000Z',
    }))
    expect(serialized.definitions[0]?.parameters).toEqual(definition.parameters)
    expect(serialized.graph.nodes.find((node) => node.id === 'main-wheel-call')?.parameters).toEqual(
      project.graph.nodes.find((node) => node.id === 'main-wheel-call')?.parameters,
    )
    expect(parseScadletProject(JSON.parse(JSON.stringify(serialized)))).toEqual(serialized)
  })
})

import { NodeEditor } from 'rete'
import { DataflowEngine } from 'rete-engine'
import { describe, expect, it } from 'vitest'

import { bindDefinitionRegistry, DefinitionRegistry } from './definitions'
import { evaluateInspectNode } from './evaluate'
import { CubeNode } from './nodes/cube-node'
import { ModuleInputsNode } from './nodes/module-interface-nodes'
import { NumberNode } from './nodes/value-nodes'
import type { Schemes } from './schemes'

async function moduleWithGeometryInput() {
  const editor = new NodeEditor<Schemes>()
  const engine = new DataflowEngine<Schemes>((node) => ({ inputs: () => Object.keys(node.inputs), outputs: () => Object.keys(node.outputs) }))
  editor.use(engine)
  const definitions = new DefinitionRegistry()
  bindDefinitionRegistry(editor, definitions)
  const geometryInputs = [{ id: 'child', name: 'Geometry 1' }]
  definitions.add({ id: 'shape', kind: 'module', name: 'shape', inputsNodeId: 'shape-in', outputNodeId: 'shape-out', parameters: [], geometryInputs })
  const inputs = new ModuleInputsNode([], geometryInputs)
  inputs.id = 'shape-in'
  const cube = new CubeNode()
  const number = new NumberNode({ value: 3, name: 'Number' })
  for (const node of [inputs, cube, number]) await editor.addNode(node)
  return { editor, engine, definitions, inputs, cube, number }
}

describe('main Geometry output (Inspect and source roots)', () => {
  it('inspects ordinary Geometry and values, but not a Module Inputs node whose Geometry outputs are dynamic', async () => {
    const { editor, engine, definitions, inputs, cube, number } = await moduleWithGeometryInput()
    await expect(evaluateInspectNode(editor, engine, cube.id, definitions)).resolves.toMatchObject({ kind: 'geometry' })
    await expect(evaluateInspectNode(editor, engine, number.id, definitions)).resolves.toMatchObject({ kind: 'value', expression: '3' })
    // Module Inputs exposes Geometry only as `geometry:<id>`; Inspect has no
    // main Geometry output to evaluate there and reports nothing to show.
    await expect(evaluateInspectNode(editor, engine, inputs.id, definitions)).resolves.toEqual({ kind: 'missing' })
  })
})

import { NodeEditor } from 'rete'
import { DataflowEngine } from 'rete-engine'
import { describe, expect, it } from 'vitest'

import { evaluateOpenSCAD } from './evaluate'
import { CubeNode } from './nodes/cube-node'
import { ModuleCallNode } from './nodes/module-call-node'
import { ModuleInputsNode, ModuleOutputNode } from './nodes/module-interface-nodes'
import { DefinitionRegistry } from './definitions'
import { ClassicPreset } from 'rete'
import type { Schemes } from './schemes'

function createGraph() {
  const editor = new NodeEditor<Schemes>()
  const engine = new DataflowEngine<Schemes>((node) => ({
    inputs: () => Object.keys(node.inputs),
    outputs: () => Object.keys(node.outputs),
  }))
  editor.use(engine)
  return { editor, engine }
}

describe('evaluateOpenSCAD', () => {
  it('returns an empty string for a graph with zero nodes, without throwing', async () => {
    // This is the state a fresh SCADlet session now starts in (the
    // automatic startup Cube was removed) and also what clicking "Render"
    // against an empty canvas evaluates - must never crash.
    const { editor, engine } = createGraph()

    const source = await evaluateOpenSCAD(editor, engine)

    expect(source).toBe('')
  })

  it('still evaluates a graph with an explicitly added node normally', async () => {
    const { editor, engine } = createGraph()
    await editor.addNode(new CubeNode())

    const source = await evaluateOpenSCAD(editor, engine)

    expect(source).toBe('cube(10);')
  })

  it('emits all Module declarations before Main and only renders a body through a Main call', async () => {
    const { editor, engine } = createGraph()
    const definitions = new DefinitionRegistry()
    const definition = { id: 'wheel', kind: 'module' as const, name: 'wheel', inputsNodeId: 'wheel-inputs', outputNodeId: 'wheel-output' }
    definitions.add(definition)
    const inputs = new ModuleInputsNode(); inputs.id = definition.inputsNodeId
    const output = new ModuleOutputNode(); output.id = definition.outputNodeId
    const cube = new CubeNode(); cube.id = 'wheel-cube'
    const call = new ModuleCallNode(definition.id, definition.name); call.id = 'main-wheel'
    for (const node of [inputs, output, cube, call]) await editor.addNode(node)
    definitions.assignNode(definition.id, cube.id)
    await editor.addConnection(new ClassicPreset.Connection(cube, 'geometry', output, 'geometry') as Schemes['Connection'])

    expect(await evaluateOpenSCAD(editor, engine, undefined, definitions)).toBe('module wheel() {\n  cube(10);\n}\n\nwheel();')
    await editor.removeNode(call.id)
    expect(await evaluateOpenSCAD(editor, engine, undefined, definitions)).toBe('module wheel() {\n  cube(10);\n}')
  })
})

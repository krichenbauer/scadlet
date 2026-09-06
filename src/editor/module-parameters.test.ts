import { ClassicPreset, NodeEditor } from 'rete'
import { DataflowEngine } from 'rete-engine'
import { describe, expect, it } from 'vitest'

import { DefinitionRegistry, moduleParameterPortId, type ModuleDefinition } from './definitions'
import { evaluateInspectNode, evaluateOpenSCAD } from './evaluate'
import { ModuleCallNode } from './nodes/module-call-node'
import { ModuleInputsNode, ModuleOutputNode } from './nodes/module-interface-nodes'
import { SphereNode } from './nodes/sphere-node'
import { MathNode } from './nodes/value-nodes'
import type { Schemes } from './schemes'

function graph() {
  const editor = new NodeEditor<Schemes>()
  const engine = new DataflowEngine<Schemes>((node) => ({ inputs: () => Object.keys(node.inputs), outputs: () => Object.keys(node.outputs) }))
  editor.use(engine)
  return { editor, engine }
}

const definition: ModuleDefinition = {
  id: 'ball', kind: 'module', name: 'ball', inputsNodeId: 'ball-inputs', outputNodeId: 'ball-output',
  parameters: [
    { id: 'radius-id', name: 'radius', type: 'number', default: 10 },
    { id: 'enabled-id', name: 'enabled', type: 'boolean', default: false },
    { id: 'offset-id', name: 'offset', type: 'vector3', default: [0, 0, 0] },
  ],
}

describe('typed Module parameters', () => {
  it('uses stable parameter ids for typed interface/call ports and preserves independent Call fallbacks', () => {
    const inputs = new ModuleInputsNode(definition.parameters)
    const first = new ModuleCallNode(definition)
    const second = new ModuleCallNode(definition)
    expect(Object.keys(inputs.outputs)).toEqual((definition.parameters ?? []).map((parameter) => moduleParameterPortId(parameter.id)))
    expect(inputs.outputs[moduleParameterPortId('radius-id')]?.socket.name).toBe('number')
    expect(inputs.outputs[moduleParameterPortId('enabled-id')]?.socket.name).toBe('boolean')
    expect(inputs.outputs[moduleParameterPortId('offset-id')]?.socket.name).toBe('vector3')
    expect(first.inputs[moduleParameterPortId('radius-id')]?.socket.name).toBe('number')
    ;(first.controls[moduleParameterPortId('radius-id')] as { setValue(value: number): void }).setValue(25)
    expect(first.getArguments()['radius-id']).toBe(25)
    expect(second.getArguments()['radius-id']).toBe(10)
  })

  it('retains a stable port for rename/reorder and replaces only the changed type fallback', () => {
    const inputs = new ModuleInputsNode(definition.parameters)
    const call = new ModuleCallNode(definition)
    const key = moduleParameterPortId('radius-id')
    const originalInput = call.inputs[key]
    const renamed = [{ id: 'radius-id', name: 'size', type: 'number' as const, default: 20 }, ...(definition.parameters ?? []).slice(1)]
    inputs.syncSignature(renamed); call.syncSignature(renamed)
    expect(call.inputs[key]).toBe(originalInput)
    expect(call.inputs[key]?.label).toBe('size')
    expect(call.getArguments()['radius-id']).toBe(10)

    const retagged = [{ id: 'radius-id', name: 'size', type: 'vector3' as const, default: [1, 2, 3] as [number, number, number] }, ...renamed.slice(1)]
    inputs.syncSignature(retagged); call.syncSignature(retagged, new Set(['radius-id']))
    expect(inputs.outputs[key]?.socket.name).toBe('vector3')
    expect(call.inputs[key]?.socket.name).toBe('vector3')
    expect(call.getArguments()['radius-id']).toEqual([1, 2, 3])
  })

  it('generates declarations, identifier expressions, named call arguments, and default-context Inspect source', async () => {
    const { editor, engine } = graph()
    const definitions = new DefinitionRegistry(); definitions.add(definition)
    const inputs = new ModuleInputsNode(definition.parameters); inputs.id = definition.inputsNodeId
    const output = new ModuleOutputNode(); output.id = definition.outputNodeId
    const sphere = new SphereNode({ mode: 'radius', r: 5 }); sphere.id = 'ball-sphere'
    const call = new ModuleCallNode(definition); call.id = 'ball-call'
    ;(call.controls[moduleParameterPortId('radius-id')] as { setValue(value: number): void }).setValue(25)
    for (const node of [inputs, output, sphere, call]) await editor.addNode(node)
    definitions.assignNode(definition.id, sphere.id)
    await editor.addConnection(new ClassicPreset.Connection(inputs, moduleParameterPortId('radius-id'), sphere, 'r') as Schemes['Connection'])
    await editor.addConnection(new ClassicPreset.Connection(sphere, 'geometry', output, 'geometry') as Schemes['Connection'])

    await expect(evaluateOpenSCAD(editor, engine, undefined, definitions)).resolves.toContain('module ball(radius = 10, enabled = false, offset = [0, 0, 0]) {\n  sphere(r=radius);\n}\n\nball(radius = 25, enabled = false, offset = [0, 0, 0]);')
    await expect(evaluateInspectNode(editor, engine, sphere.id, definitions)).resolves.toMatchObject({ kind: 'geometry', source: expect.stringContaining('module __scadlet_inspect_ball(radius = 10') })
  })

  it('wraps parameter-dependent value Inspect in the definition default context', async () => {
    const { editor, engine } = graph(); const definitions = new DefinitionRegistry(); definitions.add(definition)
    const inputs = new ModuleInputsNode(definition.parameters); inputs.id = definition.inputsNodeId
    const add = new MathNode('Add', '+', 'add', { a: 0, b: 5 }); add.id = 'ball-add'
    for (const node of [inputs, add]) await editor.addNode(node)
    definitions.assignNode(definition.id, add.id)
    await editor.addConnection(new ClassicPreset.Connection(inputs, moduleParameterPortId('radius-id'), add, 'a') as Schemes['Connection'])
    await expect(evaluateInspectNode(editor, engine, add.id, definitions)).resolves.toMatchObject({ kind: 'value', expression: '(radius + 5)', source: expect.stringContaining('echo("__SCADLET_VALUE__:", (radius + 5));') })
  })
})

import { ClassicPreset, NodeEditor } from 'rete'
import { DataflowEngine } from 'rete-engine'
import { describe, expect, it } from 'vitest'

import { DefinitionRegistry, moduleGeometryInputPortId, moduleParameterPortId, type ModuleDefinition } from './definitions'
import { evaluateInspectNode, evaluateOpenSCAD } from './evaluate'
import { ModuleCallNode } from './nodes/module-call-node'
import { ModuleInputsNode, ModuleOutputNode } from './nodes/module-interface-nodes'
import { SphereNode } from './nodes/sphere-node'
import { TranslateNode } from './nodes/translate-node'
import { CubeNode } from './nodes/cube-node'
import { MathNode, NumberNode } from './nodes/value-nodes'
import { graphEndpointsAreValid } from './port-lifecycle'
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
  geometryInputs: [{ id: 'child-id', name: 'Geometry 1' }],
}

describe('typed Module parameters', () => {
  it('uses stable parameter ids for typed interface/call ports and preserves independent Call fallbacks', () => {
    const childKey = moduleGeometryInputPortId('child-id')
    const inputs = new ModuleInputsNode(definition.parameters, definition.geometryInputs)
    const first = new ModuleCallNode(definition)
    const second = new ModuleCallNode(definition)
    expect(Object.keys(inputs.outputs)).toEqual([childKey, ...(definition.parameters ?? []).map((parameter) => moduleParameterPortId(parameter.id))])
    expect(first.inputs[childKey]?.socket.name).toBe('geometry')
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

  it('models ordered children as a Geometry signature rather than a value parameter and emits complete statements', () => {
    const childKey = moduleGeometryInputPortId('child-id')
    const inputs = new ModuleInputsNode(definition.parameters, definition.geometryInputs)
    const call = new ModuleCallNode(definition)
    // Geometry dataflow values are complete OpenSCAD statements. This is
    // intentionally the pre-v4 regression: the old fixed child boundary
    // omitted the required semicolon and therefore generated invalid source
    // when connected directly to a Module Output.
    expect(inputs.data()[childKey]).toMatchObject({ code: 'children(0);' })
    expect(call.getArguments()).not.toHaveProperty('child-id')
    expect(call.data({}).geometry.code).toBe('ball(radius = 10, enabled = false, offset = [0, 0, 0]);')
    expect(call.data({ [childKey]: [{ code: 'union() {\n  cube();\n  sphere(r=3);\n}' }] }).geometry.code)
      .toBe('ball(radius = 10, enabled = false, offset = [0, 0, 0]) {\n  union() {\n    cube();\n    sphere(r=3);\n  }\n}')
  })

  it('maps stable ordered Geometry inputs to indexed complete children statements and preserves positional gaps', () => {
    const geometryInputs = [{ id: 'profile', name: 'Profile' }, { id: 'cutout', name: 'Cutout' }]
    const inputs = new ModuleInputsNode([], geometryInputs)
    const call = new ModuleCallNode({ id: 'cut', name: 'cut', parameters: [], geometryInputs })
    const profile = moduleGeometryInputPortId('profile')
    const cutout = moduleGeometryInputPortId('cutout')
    expect(inputs.data()[profile]).toMatchObject({ code: 'children(0);' })
    expect(inputs.data()[cutout]).toMatchObject({ code: 'children(1);' })
    expect(call.data({ [profile]: [{ code: 'cube(20);' }], [cutout]: [{ code: 'cylinder(r=5);' }] }).geometry.code)
      .toBe('cut() {\n  cube(20);\n  cylinder(r=5);\n}')
    expect(call.data({ [cutout]: [{ code: 'cylinder(r=5);' }] }).geometry.code)
      .toBe('cut() {\n  union() {}\n  cylinder(r=5);\n}')
    expect(call.data({}).geometry.code).toBe('cut();')
  })

  it('flows children through ordinary Rete Geometry connections in a definition and Call', async () => {
    const { editor, engine } = graph()
    const definitions = new DefinitionRegistry(); definitions.add(definition)
    const childKey = moduleGeometryInputPortId('child-id')
    const inputs = new ModuleInputsNode(definition.parameters, definition.geometryInputs); inputs.id = definition.inputsNodeId
    const output = new ModuleOutputNode(); output.id = definition.outputNodeId
    const translate = new TranslateNode({ x: 0, y: 0, z: 12 }); translate.id = 'child-translate'
    const call = new ModuleCallNode(definition); call.id = 'ball-call'
    const cube = new CubeNode(); cube.id = 'child-cube'
    for (const node of [inputs, output, translate, call, cube]) await editor.addNode(node)
    definitions.assignNode(definition.id, translate.id)
    await editor.addConnection(new ClassicPreset.Connection(inputs, childKey, translate, 'geometry') as Schemes['Connection'])
    await editor.addConnection(new ClassicPreset.Connection(translate, 'geometry', output, 'geometry') as Schemes['Connection'])
    await editor.addConnection(new ClassicPreset.Connection(cube, 'geometry', call, childKey) as Schemes['Connection'])
    await expect(evaluateOpenSCAD(editor, engine, undefined, definitions)).resolves.toMatch(/translate\(\[0, 0, 12\]\) \{\n\s+children\(0\);\n\s+\}/)
    await expect(evaluateOpenSCAD(editor, engine, undefined, definitions)).resolves.toContain('ball(radius = 10, enabled = false, offset = [0, 0, 0]) {\n  cube(10);\n}')
  })

  it('emits children(index); as the Module body when a Geometry input connects directly to Module Output', async () => {
    // Regression: `evaluateModuleBody` used to always read the fetched
    // source's `geometry` field, but a Module Inputs Geometry output is
    // keyed `geometry:<id>`, not `geometry` - a direct connection (no
    // intermediate ordinary Geometry node) therefore evaluated to `''` and
    // produced an empty Module body.
    const { editor, engine } = graph()
    const definitions = new DefinitionRegistry(); definitions.add(definition)
    const childKey = moduleGeometryInputPortId('child-id')
    const inputs = new ModuleInputsNode(definition.parameters, definition.geometryInputs); inputs.id = definition.inputsNodeId
    const output = new ModuleOutputNode(); output.id = definition.outputNodeId
    for (const node of [inputs, output]) await editor.addNode(node)
    await editor.addConnection(new ClassicPreset.Connection(inputs, childKey, output, 'geometry') as Schemes['Connection'])

    const source = await evaluateOpenSCAD(editor, engine, undefined, definitions)
    expect(source).toContain('module ball(radius = 10, enabled = false, offset = [0, 0, 0]) {\n  children(0);\n}')
    expect(source).not.toContain('{\n\n}')
  })

  it('generates the reported screenshot scenario: two Geometry inputs, the second wired to Output, produce children(1); and preserve Call child order', async () => {
    const scenario: ModuleDefinition = {
      id: 'test123', kind: 'module', name: 'test123', inputsNodeId: 'test123-inputs', outputNodeId: 'test123-output',
      parameters: [{ id: 'foo-id', name: 'foo', type: 'number', default: -2 }],
      geometryInputs: [{ id: 'foobar-id', name: 'Foobar' }, { id: 'fnord-id', name: 'Fnord' }],
    }
    const { editor, engine } = graph()
    const definitions = new DefinitionRegistry(); definitions.add(scenario)
    const inputs = new ModuleInputsNode(scenario.parameters, scenario.geometryInputs); inputs.id = scenario.inputsNodeId
    const output = new ModuleOutputNode(); output.id = scenario.outputNodeId
    const call = new ModuleCallNode(scenario); call.id = 'main-call'
    const cube = new CubeNode(); cube.id = 'main-cube'
    const sphere = new SphereNode(); sphere.id = 'main-sphere'
    for (const node of [inputs, output, call, cube, sphere]) await editor.addNode(node)
    const fnordKey = moduleGeometryInputPortId('fnord-id')
    const foobarKey = moduleGeometryInputPortId('foobar-id')
    await editor.addConnection(new ClassicPreset.Connection(inputs, fnordKey, output, 'geometry') as Schemes['Connection'])
    await editor.addConnection(new ClassicPreset.Connection(cube, 'geometry', call, foobarKey) as Schemes['Connection'])
    await editor.addConnection(new ClassicPreset.Connection(sphere, 'geometry', call, fnordKey) as Schemes['Connection'])

    const source = await evaluateOpenSCAD(editor, engine, undefined, definitions)
    expect(source).toBe(
      'module test123(foo = -2) {\n  children(1);\n}\n\n'
      + 'test123(foo = -2) {\n  cube(10);\n  sphere(r=5);\n}',
    )
  })

  it('removes a deleted signature id from Inputs and every Call only after its exact wires are removed', async () => {
    const { editor, engine } = graph()
    const definitions = new DefinitionRegistry(); definitions.add(definition)
    const inputs = new ModuleInputsNode(definition.parameters); inputs.id = definition.inputsNodeId
    const output = new ModuleOutputNode(); output.id = definition.outputNodeId
    const sphere = new SphereNode({ mode: 'radius', r: 5 }); sphere.id = 'ball-sphere'
    const firstCall = new ModuleCallNode(definition); firstCall.id = 'ball-call-one'
    const secondCall = new ModuleCallNode(definition); secondCall.id = 'ball-call-two'
    const firstSource = new NumberNode({ value: 21, name: 'First radius' }); firstSource.id = 'radius-one'
    const secondSource = new NumberNode({ value: 34, name: 'Second radius' }); secondSource.id = 'radius-two'
    for (const node of [inputs, output, sphere, firstCall, secondCall, firstSource, secondSource]) await editor.addNode(node)
    definitions.assignNode(definition.id, sphere.id)
    const radiusKey = moduleParameterPortId('radius-id')
    await editor.addConnection(new ClassicPreset.Connection(inputs, radiusKey, sphere, 'r') as Schemes['Connection'])
    await editor.addConnection(new ClassicPreset.Connection(firstSource, 'value', firstCall, radiusKey) as Schemes['Connection'])
    await editor.addConnection(new ClassicPreset.Connection(secondSource, 'value', secondCall, radiusKey) as Schemes['Connection'])
    await editor.addConnection(new ClassicPreset.Connection(sphere, 'geometry', output, 'geometry') as Schemes['Connection'])

    const removed = editor.getConnections().filter((connection) =>
      (connection.source === inputs.id && connection.sourceOutput === radiusKey)
      || ((connection.target === firstCall.id || connection.target === secondCall.id) && connection.targetInput === radiusKey),
    )
    expect(removed).toHaveLength(3)
    for (const connection of removed) await editor.removeConnection(connection.id)
    const withoutRadius = (definition.parameters ?? []).filter((parameter) => parameter.id !== 'radius-id')
    definitions.setParameters(definition.id, withoutRadius)
    inputs.syncSignature(withoutRadius)
    firstCall.syncSignature(withoutRadius)
    secondCall.syncSignature(withoutRadius)

    expect(inputs.outputs[radiusKey]).toBeUndefined()
    expect(firstCall.inputs[radiusKey]).toBeUndefined()
    expect(secondCall.inputs[radiusKey]).toBeUndefined()
    expect(firstCall.getArguments()['radius-id']).toBeUndefined()
    expect(secondCall.getArguments()['radius-id']).toBeUndefined()
    expect(editor.getConnections()).toHaveLength(1)
    expect(graphEndpointsAreValid(editor)).toBe(true)
    await expect(evaluateOpenSCAD(editor, engine, undefined, definitions)).resolves.not.toContain('radius =')
  })

  it('removes the last unconnected parameter without leaving an interface or Call fallback behind', () => {
    const only = [{ id: 'only-id', name: 'only', type: 'number' as const, default: 7 }]
    const definitionWithOne = { ...definition, parameters: only }
    const inputs = new ModuleInputsNode(only)
    const call = new ModuleCallNode(definitionWithOne)
    const key = moduleParameterPortId('only-id')
    inputs.syncSignature([])
    call.syncSignature([])
    expect(inputs.outputs[key]).toBeUndefined()
    expect(call.inputs[key]).toBeUndefined()
    expect(call.getArguments()).toEqual({})
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

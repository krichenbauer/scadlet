import { ClassicPreset, NodeEditor } from 'rete'
import { DataflowEngine } from 'rete-engine'
import { describe, expect, it, vi } from 'vitest'

import { evaluateOpenSCAD } from '../evaluate'
import { DefinitionRegistry } from '../definitions'
import type { Schemes } from '../schemes'
import { ArithmeticNode, ConditionalNode, NumberNode } from './value-nodes'
import { CubeNode } from './cube-node'
import { ModuleInputsNode, ModuleOutputNode } from './module-interface-nodes'
import { ModuleCallNode } from './module-call-node'
import { ScadSettingsNode } from './scad-settings-node'

function graph() {
  const editor = new NodeEditor<Schemes>()
  const engine = new DataflowEngine<Schemes>((node) => ({ inputs: () => Object.keys(node.inputs), outputs: () => Object.keys(node.outputs) }))
  editor.use(engine)
  return { editor, engine }
}

describe('SCAD settings node', () => {
  it('emits direct Number fallbacks in canonical setting order', () => {
    const node = new ScadSettingsNode({ fs: 1.5, fn: 48, fa: 8 })
    expect(Object.keys(node.inputs)).toEqual(['fn', 'fa', 'fs'])
    expect(node.data({}).settings.code).toBe('$fn = 48;\n$fa = 8;\n$fs = 1.5;')
    expect(node.getPersistedParams()).toEqual({ fs: 1.5, fn: 48, fa: 8 })
  })

  it('adds every kind once and removes a connected row only through the normal preflight', async () => {
    const changed = vi.fn()
    const remove = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true)
    const node = new ScadSettingsNode({}, changed, remove)
    const actions = () => node.controls.actions.actions()
    expect(actions().map((item) => item.id)).toEqual(['add-fn', 'add-fa', 'add-fs'])
    actions()[0]!.run!()
    expect(actions().map((item) => item.id)).toEqual(['add-fa', 'add-fs'])
    expect(Object.keys(node.inputs)).toEqual(['fn'])
    expect(await node.removableRows()[0]!.requestRemove()).toBe(false)
    expect(node.inputs.fn).toBeTruthy()
    expect(await node.removableRows()[0]!.requestRemove()).toBe(true)
    expect(node.inputs.fn).toBeUndefined()
    expect(changed).toHaveBeenCalledTimes(2)
  })

  it('pulls ordinary Number/Math dependencies despite having no output or Geometry flow', async () => {
    const { editor, engine } = graph()
    const number = new NumberNode({ value: 12 })
    const math = new ArithmeticNode({ operation: 'multiplication', a: 0, b: 4 })
    const settings = new ScadSettingsNode({ fn: 30 })
    const cube = new CubeNode()
    for (const node of [number, math, settings, cube]) await editor.addNode(node)
    await editor.addConnection(new ClassicPreset.Connection(number, 'value', math, 'a') as Schemes['Connection'])
    await editor.addConnection(new ClassicPreset.Connection(math, 'value', settings, 'fn') as Schemes['Connection'])

    expect(await evaluateOpenSCAD(editor, engine)).toBe('$fn = (12 * 4);\ncube(10);')
  })

  it('reports an incomplete value dependency when it becomes reachable only through settings', async () => {
    const { editor, engine } = graph()
    const number = new NumberNode({ value: 12 })
    const conditional = new ConditionalNode({ valueType: 'number' })
    const settings = new ScadSettingsNode({ fn: 30 })
    for (const node of [number, conditional, settings]) await editor.addNode(node)
    await editor.addConnection(new ClassicPreset.Connection(number, 'value', conditional, 'true') as Schemes['Connection'])
    await editor.addConnection(new ClassicPreset.Connection(conditional, 'result', settings, 'fn') as Schemes['Connection'])

    await expect(evaluateOpenSCAD(editor, engine)).rejects.toThrow('Conditional needs connected Condition, True, and False inputs')
  })

  it('prepends Main settings and Module-local overrides inside the module body', async () => {
    const { editor, engine } = graph()
    const definitions = new DefinitionRegistry()
    const definition = { id: 'part', kind: 'module' as const, name: 'part', inputsNodeId: 'part-in', outputNodeId: 'part-out', parameters: [], geometryInputs: [] }
    definitions.add(definition)
    const inputs = new ModuleInputsNode(); inputs.id = definition.inputsNodeId
    const output = new ModuleOutputNode(); output.id = definition.outputNodeId
    const localSettings = new ScadSettingsNode({ fn: 12 }); localSettings.id = 'part-settings'
    const cube = new CubeNode(); cube.id = 'part-cube'
    const mainSettings = new ScadSettingsNode({ fn: 64 }); mainSettings.id = 'main-settings'
    const call = new ModuleCallNode(definition); call.id = 'main-call'
    for (const node of [inputs, output, localSettings, cube, mainSettings, call]) await editor.addNode(node)
    definitions.assignNode(definition.id, localSettings.id)
    definitions.assignNode(definition.id, cube.id)
    await editor.addConnection(new ClassicPreset.Connection(cube, 'geometry', output, 'geometry') as Schemes['Connection'])

    expect(await evaluateOpenSCAD(editor, engine, undefined, definitions)).toBe(
      'module part() {\n  $fn = 12;\n  cube(10);\n}\n\n$fn = 64;\npart();',
    )
  })

  it('evaluates a Module setting from the owning Module parameter context', async () => {
    const { editor, engine } = graph()
    const definitions = new DefinitionRegistry()
    const parameter = { id: 'detail', name: 'detail', type: 'number' as const, default: 24 }
    const definition = { id: 'part', kind: 'module' as const, name: 'part', inputsNodeId: 'part-in', outputNodeId: 'part-out', parameters: [parameter], geometryInputs: [] }
    definitions.add(definition)
    const inputs = new ModuleInputsNode([parameter]); inputs.id = definition.inputsNodeId
    const output = new ModuleOutputNode(); output.id = definition.outputNodeId
    const settings = new ScadSettingsNode({ fn: 30 }); settings.id = 'part-settings'
    const cube = new CubeNode(); cube.id = 'part-cube'
    const call = new ModuleCallNode(definition); call.id = 'main-call'
    for (const node of [inputs, output, settings, cube, call]) await editor.addNode(node)
    definitions.assignNode(definition.id, settings.id)
    definitions.assignNode(definition.id, cube.id)
    await editor.addConnection(new ClassicPreset.Connection(inputs, 'parameter:detail', settings, 'fn') as Schemes['Connection'])
    await editor.addConnection(new ClassicPreset.Connection(cube, 'geometry', output, 'geometry') as Schemes['Connection'])

    expect(await evaluateOpenSCAD(editor, engine, undefined, definitions)).toContain(
      'module part(detail = 24) {\n  $fn = detail;\n  cube(10);\n}',
    )
  })
})

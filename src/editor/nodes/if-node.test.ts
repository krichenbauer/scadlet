import { ClassicPreset, NodeEditor } from 'rete'
import { DataflowEngine } from 'rete-engine'
import { describe, expect, it } from 'vitest'

import { t } from '../../i18n/translate'
import { evaluateOpenSCAD } from '../evaluate'
import type { Schemes } from '../schemes'
import { BooleanNode } from './value-nodes'
import { CubeNode } from './cube-node'
import { SphereNode } from './sphere-node'
import { TranslateNode } from './translate-node'
import { IfNode, ifToOpenSCAD } from './if-node'
import { DefinitionRegistry } from '../definitions'
import { ModuleInputsNode, ModuleOutputNode } from './module-interface-nodes'
import { scopeTransferProblem } from '../scope-transfer'

function graph() {
  const editor = new NodeEditor<Schemes>()
  const engine = new DataflowEngine<Schemes>((node) => ({ inputs: () => Object.keys(node.inputs), outputs: () => Object.keys(node.outputs) }))
  editor.use(engine)
  return { editor, engine }
}

function connect(source: Schemes['Node'], output: string, target: Schemes['Node'], input: string): Schemes['Connection'] {
  return new ClassicPreset.Connection(source, output, target, input) as Schemes['Connection']
}

describe('Geometry If node', () => {
  it('has fixed, typed semantic ports and a canonical Geometry output', () => {
    const node = new IfNode()
    expect(Object.keys(node.inputs)).toEqual(['condition', 'then', 'else'])
    expect(Object.keys(node.outputs)).toEqual(['geometry'])
    expect(node.inputs.condition?.label).toBe(t('input.condition'))
    expect(node.inputs.then?.label).toBe(t('input.then'))
    expect(node.inputs.else?.label).toBe(t('input.else'))
    expect(node.inputs.condition?.socket.name).toBe('boolean')
    expect(node.inputs.then?.socket.name).toBe('geometry')
    expect(node.inputs.else?.socket.name).toBe('geometry')
    expect(node.outputs.geometry?.socket.name).toBe('geometry')
  })

  it('emits exact Then-only and Then/Else OpenSCAD statement forms', () => {
    expect(ifToOpenSCAD('ready', 'cube(10);')).toBe('if (ready) {\n  cube(10);\n}')
    expect(ifToOpenSCAD('ready', 'cube(10);', 'sphere(5);')).toBe('if (ready) {\n  cube(10);\n} else {\n  sphere(5);\n}')
  })

  it('composes through transforms and nests without changing Geometry semantics', async () => {
    const { editor, engine } = graph()
    const condition = new BooleanNode({ value: true })
    const then = new CubeNode()
    const otherwise = new SphereNode()
    const inner = new IfNode()
    const outer = new IfNode()
    const transform = new TranslateNode({ x: 1, y: 2, z: 3 })
    for (const node of [condition, then, otherwise, inner, outer, transform]) await editor.addNode(node)
    await editor.addConnection(connect(condition, 'value', inner, 'condition'))
    await editor.addConnection(connect(then, 'geometry', inner, 'then'))
    await editor.addConnection(connect(otherwise, 'geometry', inner, 'else'))
    await editor.addConnection(connect(condition, 'value', outer, 'condition'))
    await editor.addConnection(connect(inner, 'geometry', outer, 'then'))
    await editor.addConnection(connect(otherwise, 'geometry', outer, 'else'))
    await editor.addConnection(connect(outer, 'geometry', transform, 'geometry'))

    expect(await evaluateOpenSCAD(editor, engine)).toBe(
      'translate([1, 2, 3]) {\n    if (true) {\n      if (true) {\n        cube(10);\n      } else {\n        sphere(r=5);\n      }\n    } else {\n      sphere(r=5);\n    }\n}',
    )
  })

  it('rejects only reachable drafts missing Condition or Then, while an Else-less If is valid', async () => {
    const { editor, engine } = graph()
    const condition = new BooleanNode({ value: true })
    const cube = new CubeNode()
    const complete = new IfNode()
    const draft = new IfNode()
    for (const node of [condition, cube, complete, draft]) await editor.addNode(node)
    await editor.addConnection(connect(condition, 'value', complete, 'condition'))
    await editor.addConnection(connect(cube, 'geometry', complete, 'then'))
    expect(await evaluateOpenSCAD(editor, engine)).toBe('if (true) {\n  cube(10);\n}')

    await editor.addConnection(connect(cube, 'geometry', draft, 'then'))
    await editor.addConnection(connect(draft, 'geometry', complete, 'else'))
    await expect(evaluateOpenSCAD(editor, engine)).rejects.toThrow('If needs connected Condition and Then')
  })

  it('is valid as a Module Output root and cannot transfer into a Function scope', async () => {
    const { editor, engine } = graph()
    const definitions = new DefinitionRegistry()
    const module = { id: 'branch', kind: 'module' as const, name: 'branch', inputsNodeId: 'branch-inputs', outputNodeId: 'branch-output', parameters: [], geometryInputs: [] }
    const functionDefinition = { id: 'value', kind: 'function' as const, name: 'value', inputsNodeId: 'value-inputs', outputNodeId: 'value-output', parameters: [] }
    definitions.add(module)
    definitions.add(functionDefinition)
    const inputs = new ModuleInputsNode(); inputs.id = module.inputsNodeId
    const output = new ModuleOutputNode(); output.id = module.outputNodeId
    const condition = new BooleanNode({ value: true })
    const cube = new CubeNode()
    const ifNode = new IfNode()
    for (const node of [inputs, output, condition, cube, ifNode]) await editor.addNode(node)
    for (const node of [inputs, output, condition, cube, ifNode]) definitions.assignNode(module.id, node.id)
    await editor.addConnection(connect(condition, 'value', ifNode, 'condition'))
    await editor.addConnection(connect(cube, 'geometry', ifNode, 'then'))
    await editor.addConnection(connect(ifNode, 'geometry', output, 'geometry'))

    expect(await evaluateOpenSCAD(editor, engine, undefined, definitions)).toBe('module branch() {\n  if (true) {\n    cube(10);\n  }\n}')
    expect(scopeTransferProblem(editor, definitions, [ifNode.id], functionDefinition.id)).toBe('function-incompatible')
  })
})

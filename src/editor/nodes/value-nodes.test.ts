import { ClassicPreset, NodeEditor } from 'rete'
import { DataflowEngine } from 'rete-engine'
import { describe, expect, it } from 'vitest'

import { evaluateInspectNode, evaluateOpenSCAD } from '../evaluate'
import type { Schemes } from '../schemes'
import { CubeNode } from './cube-node'
import { BooleanNode, CompareNode, ConditionalNode, MathNode, NumberNode, Vector3Node } from './value-nodes'

function engine(): DataflowEngine<Schemes> {
  return new DataflowEngine<Schemes>((node) => ({ inputs: () => Object.keys(node.inputs), outputs: () => Object.keys(node.outputs) }))
}

function connect(source: ClassicPreset.Node, sourceOutput: string, target: ClassicPreset.Node, targetInput: string) {
  return new ClassicPreset.Connection<ClassicPreset.Node, ClassicPreset.Node>(source, sourceOutput, target, targetInput)
}

describe('Milestone 7 value nodes', () => {
  it('generates OpenSCAD expressions without JavaScript evaluation', () => {
    expect(new NumberNode({ value: 20 }).data().value.code).toBe('20')
    expect(new BooleanNode({ value: true }).data().value.code).toBe('true')
    expect(new Vector3Node({ x: 1, y: 2, z: 3 }).data({}).value.code).toBe('[1, 2, 3]')
    expect(new MathNode('Add', '+', 'add', { a: 5, b: 10 }).data({}).value.code).toBe('(5 + 10)')
    expect(new MathNode('Divide', '/', 'divide', { a: 1, b: 0 }).data({}).value.code).toBe('(1 / 0)')
  })

  it('keeps source names as descriptive persisted metadata, not OpenSCAD identifiers', () => {
    const number = new NumberNode({ name: 'Wall thickness', value: 2.5 })
    const boolean = new BooleanNode({ name: 'Centered', value: true })
    const vector = new Vector3Node({ name: 'Translation', x: 10, y: 20, z: 30 })
    expect(number.getPersistedParams()).toEqual({ name: 'Wall thickness', value: 2.5 })
    expect(boolean.getPersistedParams()).toEqual({ name: 'Centered', value: true })
    expect(vector.getPersistedParams()).toEqual({ name: 'Translation', x: 10, y: 20, z: 30 })
    expect(number.data().value.code).toBe('2.5')
    expect(boolean.data().value.code).toBe('true')
    expect(vector.data({}).value.code).toBe('[10, 20, 30]')
  })

  it('feeds Number, Vector3, and Boolean expressions into existing Cube inputs', async () => {
    const editor = new NodeEditor<Schemes>()
    const dataflow = engine()
    const cube = new CubeNode({ sizeRepresentation: 'scalar', size: 2, center: false })
    const number = new NumberNode({ value: 20 })
    const boolean = new BooleanNode({ value: true })
    editor.use(dataflow)
    await editor.addNode(cube); await editor.addNode(number); await editor.addNode(boolean)
    await editor.addConnection(connect(number, 'value', cube, 'size'))
    await editor.addConnection(connect(boolean, 'value', cube, 'center'))
    expect(await evaluateOpenSCAD(editor, dataflow)).toBe('cube(20, center=true);')
  })

  it('keeps connected math grouped and exposes a value inspect expression', async () => {
    const editor = new NodeEditor<Schemes>()
    const dataflow = engine()
    const left = new NumberNode({ value: 5 })
    const right = new NumberNode({ value: 10 })
    const add = new MathNode('Add', '+', 'add')
    editor.use(dataflow)
    await editor.addNode(left); await editor.addNode(right); await editor.addNode(add)
    await editor.addConnection(connect(left, 'value', add, 'a'))
    await editor.addConnection(connect(right, 'value', add, 'b'))
    await expect(evaluateInspectNode(editor, dataflow, add.id)).resolves.toEqual({ kind: 'value', expression: '(5 + 10)' })
  })

  it('persists every numeric Compare operator and emits fully parenthesized Boolean expressions', () => {
    for (const operator of ['<', '<=', '>', '>=', '==', '!='] as const) {
      const compare = new CompareNode({ operator })
      expect(compare.inputs.a?.socket.name).toBe('number')
      expect(compare.inputs.b?.socket.name).toBe('number')
      expect(compare.outputs.value?.socket.name).toBe('boolean')
      expect(compare.getPersistedParams()).toEqual({ operator })
      expect(compare.data({ a: [{ code: 'a' }], b: [{ code: 'b' }] }).value.code).toBe(`(a ${operator} b)`)
    }
  })

  it('infers Conditional Number, Boolean, and Vector3 expressions without changing stable port ids', () => {
    const cases = [
      ['number', { code: '1' }, { code: '2' }, '(ready ? 1 : 2)'],
      ['boolean', { code: 'true' }, { code: 'false' }, '(ready ? true : false)'],
      ['vector3', { code: '[1, 2, 3]' }, { code: '[4, 5, 6]' }, '(ready ? [1, 2, 3] : [4, 5, 6])'],
    ] as const
    for (const [type, whenTrue, whenFalse, source] of cases) {
      const conditional = new ConditionalNode()
      expect(conditional.outputs.result?.socket.name).toBe('unresolved')
      conditional.setValueType(type)
      expect(Object.keys(conditional.inputs)).toEqual(['condition', 'true', 'false'])
      expect(conditional.inputs.true?.socket.name).toBe(type)
      expect(conditional.inputs.false?.socket.name).toBe(type)
      expect(conditional.outputs.result?.socket.name).toBe(type)
      expect(conditional.data({ condition: [{ code: 'ready' }], true: [whenTrue], false: [whenFalse] }).result?.code).toBe(source)
      expect(conditional.getPersistedParams()).toEqual({ valueType: type })
    }
  })

  it('feeds Compare into Conditional and preserves grouping through nested math', async () => {
    const editor = new NodeEditor<Schemes>()
    const dataflow = engine()
    editor.use(dataflow)
    const left = new NumberNode({ value: 2 })
    const right = new NumberNode({ value: 3 })
    const compare = new CompareNode({ operator: '<=' })
    const add = new MathNode('Add', '+', 'add', { a: 1, b: 2 })
    const conditional = new ConditionalNode({ valueType: 'number' })
    const cube = new CubeNode({ sizeRepresentation: 'scalar', size: 1 })
    for (const node of [left, right, compare, add, conditional, cube]) await editor.addNode(node)
    await editor.addConnection(connect(left, 'value', compare, 'a'))
    await editor.addConnection(connect(right, 'value', compare, 'b'))
    await editor.addConnection(connect(compare, 'value', conditional, 'condition'))
    await editor.addConnection(connect(add, 'value', conditional, 'true'))
    await editor.addConnection(connect(right, 'value', conditional, 'false'))
    await editor.addConnection(connect(conditional, 'result', cube, 'size'))
    expect(await evaluateOpenSCAD(editor, dataflow)).toBe('cube(((2 <= 3) ? (1 + 2) : 3));')
  })

  it('fails a reachable incomplete Conditional clearly while a dead draft is harmless', async () => {
    const editor = new NodeEditor<Schemes>()
    const dataflow = engine()
    editor.use(dataflow)
    const conditional = new ConditionalNode({ valueType: 'number' })
    const number = new NumberNode({ value: 5 })
    const cube = new CubeNode({ sizeRepresentation: 'scalar', size: 1 })
    for (const node of [conditional, number, cube]) await editor.addNode(node)
    await editor.addConnection(connect(number, 'value', conditional, 'true'))
    await editor.addConnection(connect(conditional, 'result', cube, 'size'))
    await expect(evaluateOpenSCAD(editor, dataflow)).rejects.toThrow('Conditional needs connected Condition, True, and False')
    await editor.removeConnection(editor.getConnections().find((item) => item.source === conditional.id)!.id)
    await expect(evaluateOpenSCAD(editor, dataflow)).resolves.toBe('cube(1);')
  })
})

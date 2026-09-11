import { ClassicPreset, NodeEditor } from 'rete'
import { DataflowEngine } from 'rete-engine'
import { describe, expect, it } from 'vitest'

import { evaluateInspectNode, evaluateOpenSCAD } from '../evaluate'
import { transitionTrigonometryOperation } from '../editor'
import type { Schemes } from '../schemes'
import { CubeNode } from './cube-node'
import { ArithmeticNode, BASIC_MATH_OPERATIONS, BasicMathNode, BooleanNode, CompareNode, ConditionalNode, EXPONENTIAL_LOG_OPERATIONS, ExponentialLogNode, NumberNode, TRIGONOMETRY_OPERATIONS, TrigonometryNode, Vector3Node } from './value-nodes'

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
    expect(new ArithmeticNode({ operation: 'addition', a: 5, b: 10 }).data({}).value.code).toBe('(5 + 10)')
    expect(new ArithmeticNode({ operation: 'division', a: 1, b: 0 }).data({}).value.code).toBe('(1 / 0)')
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
    const add = new ArithmeticNode()
    editor.use(dataflow)
    await editor.addNode(left); await editor.addNode(right); await editor.addNode(add)
    await editor.addConnection(connect(left, 'value', add, 'a'))
    await editor.addConnection(connect(right, 'value', add, 'b'))
    await expect(evaluateInspectNode(editor, dataflow, add.id)).resolves.toEqual({ kind: 'value', expression: '(5 + 10)' })
  })

  it('exposes two independent Number fallbacks for every Compare operator and emits fully parenthesized Boolean expressions', () => {
    for (const operator of ['<', '<=', '>', '>=', '==', '!='] as const) {
      const compare = new CompareNode({ operator, a: 3, b: 10 })
      expect(Object.keys(compare.inputs)).toEqual(['a', 'b'])
      expect(Object.keys(compare.controls)).toEqual(['operator', 'a', 'b'])
      expect(compare.inputs.a?.socket.name).toBe('number')
      expect(compare.inputs.b?.socket.name).toBe('number')
      expect(compare.outputs.value?.socket.name).toBe('boolean')
      expect(compare.getPersistedParams()).toEqual({ operator, a: 3, b: 10 })
      expect(compare.data({}).value.code).toBe(`(3 ${operator} 10)`)
      expect(compare.data({ a: [{ code: 'a' }], b: [{ code: 'b' }] }).value.code).toBe(`(a ${operator} b)`)
    }
  })

  it('keeps independent Compare fallbacks through edits, operator changes, connections, and disconnection', async () => {
    const editor = new NodeEditor<Schemes>()
    const dataflow = engine()
    editor.use(dataflow)
    const left = new NumberNode({ value: 42 })
    const right = new NumberNode({ value: 99 })
    const compare = new CompareNode()
    await editor.addNode(left); await editor.addNode(right); await editor.addNode(compare)

    compare.controls.a.setValue(3)
    compare.controls.b.setValue(10)
    expect(compare.getPersistedParams()).toEqual({ operator: '<', a: 3, b: 10 })
    expect(compare.data({}).value.code).toBe('(3 < 10)')

    const aConnection = connect(left, 'value', compare, 'a')
    const bConnection = connect(right, 'value', compare, 'b')
    await editor.addConnection(aConnection); await editor.addConnection(bConnection)
    expect(compare.data({ a: [{ code: '42' }], b: [{ code: '99' }] }).value.code).toBe('(42 < 99)')
    await compare.controls.operator.requestValue('>')
    expect(compare.getPersistedParams()).toEqual({ operator: '>', a: 3, b: 10 })
    expect(editor.getConnections().map((item) => item.id)).toEqual([aConnection.id, bConnection.id])
    expect(await evaluateInspectNode(editor, dataflow, compare.id)).toEqual({ kind: 'value', expression: '(42 > 99)' })

    await editor.removeConnection(aConnection.id)
    expect(await evaluateInspectNode(editor, dataflow, compare.id)).toEqual({ kind: 'value', expression: '(3 > 99)' })
    await editor.removeConnection(bConnection.id)
    expect(await evaluateInspectNode(editor, dataflow, compare.id)).toEqual({ kind: 'value', expression: '(3 > 10)' })
  })

  it('exposes exact Arithmetic signatures and OpenSCAD for every operation', () => {
    const cases = [
      ['addition', '(a + b)'], ['subtraction', '(a - b)'], ['multiplication', '(a * b)'],
      ['division', '(a / b)'], ['modulo', '(a % b)'], ['power', 'pow(a, b)'],
    ] as const
    for (const [operation, source] of cases) {
      const node = new ArithmeticNode({ operation, a: 1, b: 2 })
      expect(Object.keys(node.inputs)).toEqual(['a', 'b'])
      expect(node.inputs.a?.label).toBe('A')
      expect(node.inputs.b?.label).toBe('B')
      expect(node.inputs.a?.socket.name).toBe('number')
      expect(node.inputs.b?.socket.name).toBe('number')
      expect(Object.keys(node.outputs)).toEqual(['value'])
      expect(node.outputs.value?.socket.name).toBe('number')
      expect(node.data({ a: [{ code: 'a' }], b: [{ code: 'b' }] }).value.code).toBe(source)
    }
  })

  it('exposes exact unary Math signatures and OpenSCAD expressions', () => {
    for (const operation of BASIC_MATH_OPERATIONS) {
      const node = new BasicMathNode({ operation, x: 4 })
      expect(Object.keys(node.inputs)).toEqual(['x'])
      expect(node.inputs.x?.label).toBe('X')
      expect(node.inputs.x?.socket.name).toBe('number')
      expect(node.outputs.value?.socket.name).toBe('number')
      expect(node.data({ x: [{ code: 'x' }] }).value.code).toBe(`${operation}(x)`)
    }
    for (const operation of EXPONENTIAL_LOG_OPERATIONS) {
      const node = new ExponentialLogNode({ operation, x: 4 })
      expect(Object.keys(node.inputs)).toEqual(['x'])
      expect(node.inputs.x?.label).toBe('X')
      expect(node.outputs.value?.socket.name).toBe('number')
      expect(node.data({ x: [{ code: 'x' }] }).value.code).toBe(`${operation}(x)`)
    }
    for (const operation of TRIGONOMETRY_OPERATIONS.filter((item) => item !== 'atan2')) {
      const node = new TrigonometryNode({ operation, a: 4, b: 0, inputPorts: ['a'] })
      expect(Object.keys(node.inputs)).toEqual(['a'])
      expect(node.inputs.a?.label).toBe('X')
      expect(node.inputs.a?.socket.name).toBe('number')
      expect(node.outputs.value?.socket.name).toBe('number')
      expect(node.data({ a: [{ code: 'x' }] }).value.code).toBe(`${operation}(x)`)
    }
  })

  it('uses stable a/b ids with semantic y/x labels for atan2(y, x)', () => {
    const node = new TrigonometryNode({ operation: 'atan2', a: 1, b: 2, inputPorts: ['a', 'b'] })
    expect(Object.keys(node.inputs)).toEqual(['a', 'b'])
    expect(node.inputs.a?.label).toBe('Y')
    expect(node.inputs.b?.label).toBe('X')
    expect(node.getPersistedParams().inputPorts).toEqual(['a', 'b'])
    expect(node.data({ a: [{ code: 'y' }], b: [{ code: 'x' }] }).value.code).toBe('atan2(y, x)')
  })

  it('preserves compatible wires when fixed-shape Arithmetic, Compare, and unary operations change', async () => {
    const editor = new NodeEditor<Schemes>()
    const source = new NumberNode({ value: 2 })
    const arithmetic = new ArithmeticNode()
    const compare = new CompareNode()
    const basic = new BasicMathNode()
    const exponential = new ExponentialLogNode()
    for (const node of [source, arithmetic, compare, basic, exponential]) await editor.addNode(node)
    await editor.addConnection(connect(source, 'value', arithmetic, 'a'))
    await editor.addConnection(connect(source, 'value', compare, 'a'))
    await editor.addConnection(connect(source, 'value', basic, 'x'))
    await editor.addConnection(connect(source, 'value', exponential, 'x'))
    const ids = editor.getConnections().map((item) => item.id)
    await (arithmetic.controls.operation as { requestValue(value: 'power'): Promise<boolean> }).requestValue('power')
    await compare.controls.operator.requestValue('>=')
    await (basic.controls.operation as { requestValue(value: 'sqrt'): Promise<boolean> }).requestValue('sqrt')
    await (exponential.controls.operation as { requestValue(value: 'ln'): Promise<boolean> }).requestValue('ln')
    expect(editor.getConnections().map((item) => item.id)).toEqual(ids)
  })

  it('adds atan2 input once, cancels connected removal without mutation, then removes only b on confirmation', async () => {
    const editor = new NodeEditor<Schemes>()
    const y = new NumberNode({ value: 2 })
    const x = new NumberNode({ value: 3 })
    const trig = new TrigonometryNode()
    const arithmetic = new ArithmeticNode()
    for (const node of [y, x, trig, arithmetic]) await editor.addNode(node)
    const first = connect(y, 'value', trig, 'a')
    const downstream = connect(trig, 'value', arithmetic, 'a')
    await editor.addConnection(first); await editor.addConnection(downstream)

    expect(await transitionTrigonometryOperation(editor, trig, 'atan2', () => true)).toBe(true)
    expect(Object.keys(trig.inputs)).toEqual(['a', 'b'])
    expect(editor.getConnections().map((item) => item.id)).toEqual([first.id, downstream.id])
    const second = connect(x, 'value', trig, 'b')
    await editor.addConnection(second)
    const before = structuredClone(trig.getPersistedParams())
    const beforeConnections = editor.getConnections().map((item) => item.id)
    expect(await transitionTrigonometryOperation(editor, trig, 'sin', () => false)).toBe(false)
    expect(trig.getPersistedParams()).toEqual(before)
    expect(editor.getConnections().map((item) => item.id)).toEqual(beforeConnections)

    expect(await transitionTrigonometryOperation(editor, trig, 'cos', () => true)).toBe(true)
    expect(Object.keys(trig.inputs)).toEqual(['a'])
    expect(editor.getConnections().map((item) => item.id)).toEqual([first.id, downstream.id])
    expect(trig.getPersistedParams()).toEqual({ operation: 'cos', a: 0, b: 0, inputPorts: ['a'] })
    await transitionTrigonometryOperation(editor, trig, 'atan2', () => true)
    await transitionTrigonometryOperation(editor, trig, 'tan', () => true)
    expect(Object.keys(trig.inputs)).toEqual(['a'])
  })

  it('rolls an atan2 removal and its wire back when the renderer update fails', async () => {
    const editor = new NodeEditor<Schemes>()
    const x = new NumberNode({ value: 3 })
    const trig = new TrigonometryNode({ operation: 'atan2', a: 1, b: 9, inputPorts: ['a', 'b'] })
    await editor.addNode(x); await editor.addNode(trig)
    const wire = connect(x, 'value', trig, 'b'); await editor.addConnection(wire)
    expect(await transitionTrigonometryOperation(editor, trig, 'sin', () => true, () => { throw new Error('render failed') })).toBe(false)
    expect(trig.getPersistedParams()).toEqual({ operation: 'atan2', a: 1, b: 9, inputPorts: ['a', 'b'] })
    expect(editor.getConnections().map((item) => item.id)).toEqual([wire.id])
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
      expect(Object.keys(conditional.inputs)).toEqual(['condition', 'true', 'false'])
      expect(Object.values(conditional.inputs).map((input) => input?.label)).toEqual(['Condition', 'Case: True', 'Case: False'])
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
    const compare = new CompareNode({ operator: '<=', a: 0, b: 0 })
    const add = new ArithmeticNode({ operation: 'addition', a: 1, b: 2 })
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

import { ClassicPreset, NodeEditor } from 'rete'
import { DataflowEngine } from 'rete-engine'
import { describe, expect, it } from 'vitest'

import { evaluateInspectNode, evaluateOpenSCAD } from '../evaluate'
import type { Schemes } from '../schemes'
import { CubeNode } from './cube-node'
import { BooleanNode, MathNode, NumberNode, Vector3Node } from './value-nodes'

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
})

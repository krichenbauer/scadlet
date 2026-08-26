import { ClassicPreset, NodeEditor } from 'rete'
import { DataflowEngine } from 'rete-engine'
import { describe, expect, it } from 'vitest'

import { evaluateOpenSCAD } from '../evaluate'
import { CubeNode } from './cube-node'
import { DifferenceNode } from './difference-node'
import { IntersectionNode } from './intersection-node'
import { RotateNode } from './rotate-node'
import { ScaleNode } from './scale-node'
import { SphereNode } from './sphere-node'
import { TranslateNode } from './translate-node'
import { UnionNode } from './union-node'
import type { Schemes } from '../schemes'

function createGraph() {
  const editor = new NodeEditor<Schemes>()
  const engine = new DataflowEngine<Schemes>((node) => ({
    inputs: () => Object.keys(node.inputs),
    outputs: () => Object.keys(node.outputs),
  }))
  editor.use(engine)
  return { editor, engine }
}

function connect(
  source: ClassicPreset.Node,
  sourceOutput: string,
  target: ClassicPreset.Node,
  targetInput: string,
) {
  return new ClassicPreset.Connection<ClassicPreset.Node, ClassicPreset.Node>(
    source,
    sourceOutput,
    target,
    targetInput,
  )
}

describe('recursive graph evaluation with the Milestone 4 nodes', () => {
  it('Cube + Sphere -> Union -> Rotate -> Translate evaluates to correctly nested OpenSCAD', async () => {
    const { editor, engine } = createGraph()

    const cube = new CubeNode()
    const sphere = new SphereNode()
    const union = new UnionNode()
    const rotate = new RotateNode({ z: 45 })
    const translate = new TranslateNode({ x: 10 })

    for (const node of [cube, sphere, union, rotate, translate]) await editor.addNode(node)

    await editor.addConnection(connect(cube, 'geometry', union, 'a'))
    await editor.addConnection(connect(sphere, 'geometry', union, 'b'))
    await editor.addConnection(connect(union, 'geometry', rotate, 'geometry'))
    await editor.addConnection(connect(rotate, 'geometry', translate, 'geometry'))

    const source = await evaluateOpenSCAD(editor, engine)

    expect(source).toBe(
      'translate([10, 0, 0]) {\n' +
        '    rotate([0, 0, 45]) {\n' +
        '        union() {\n' +
        '            cube(10);\n' +
        '            sphere(r=5);\n' +
        '        }\n' +
        '    }\n' +
        '}',
    )
  })

  it('Cube + Sphere -> Intersection evaluates with correct child ordering', async () => {
    const { editor, engine } = createGraph()

    const cube = new CubeNode()
    const sphere = new SphereNode()
    const intersection = new IntersectionNode()

    for (const node of [cube, sphere, intersection]) await editor.addNode(node)
    await editor.addConnection(connect(cube, 'geometry', intersection, 'a'))
    await editor.addConnection(connect(sphere, 'geometry', intersection, 'b'))

    const source = await evaluateOpenSCAD(editor, engine)

    expect(source).toBe('intersection() {\n    cube(10);\n    sphere(r=5);\n}')
  })

  it('mixes a new node with Difference (Scale wrapping a Difference of Cube/Sphere)', async () => {
    const { editor, engine } = createGraph()

    const cube = new CubeNode()
    const sphere = new SphereNode()
    const difference = new DifferenceNode()
    const scale = new ScaleNode({ z: 0.5 })

    for (const node of [cube, sphere, difference, scale]) await editor.addNode(node)
    await editor.addConnection(connect(cube, 'geometry', difference, 'base'))
    await editor.addConnection(connect(sphere, 'geometry', difference, 'subtract'))
    await editor.addConnection(connect(difference, 'geometry', scale, 'geometry'))

    const source = await evaluateOpenSCAD(editor, engine)

    expect(source).toBe(
      'scale([1, 1, 0.5]) {\n' +
        '    difference() {\n' +
        '        cube(10);\n' +
        '        sphere(r=5);\n' +
        '    }\n' +
        '}',
    )
  })

  it('reports a descriptive comment instead of crashing when a transform input is disconnected', async () => {
    const { editor, engine } = createGraph()
    const translate = new TranslateNode()
    await editor.addNode(translate)

    const source = await evaluateOpenSCAD(editor, engine)

    expect(source).toBe('// Translate is missing its geometry input')
  })
})

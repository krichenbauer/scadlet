import { describe, expect, it } from 'vitest'

import { classifyOutputPorts } from '../render'
import { CubeNode } from './cube-node'
import { CylinderNode } from './cylinder-node'
import { SphereNode } from './sphere-node'
import { TranslateNode } from './translate-node'
import { RotateNode } from './rotate-node'
import { ScaleNode } from './scale-node'
import { DifferenceNode } from './difference-node'
import { UnionNode } from './union-node'
import { IntersectionNode } from './intersection-node'
import { ModuleCallNode } from './module-call-node'
import { ModuleInputsNode, ModuleOutputNode } from './module-interface-nodes'

/**
 * Regression coverage for the reported duplicate Geometry output sockets:
 * `classifyOutputPorts` (extracted from `render.ts`'s `renderNode`) is the
 * single place deciding which row an output renders in. Every built-in
 * Geometry-producing node must have exactly one output, classified into
 * the stable main `.node-outputs` row and nowhere else.
 */
describe('built-in node port invariants', () => {
  it('Cube has exactly one Geometry output with the original stable port id', () => {
    const node = new CubeNode()
    expect(Object.keys(node.outputs)).toEqual(['geometry'])
    const classes = classifyOutputPorts(node.outputs)
    expect(classes.main.map(([key]) => key)).toEqual(['geometry'])
    expect(classes.dynamicGeometry).toHaveLength(0)
    expect(classes.parameter).toHaveLength(0)
  })

  it('Sphere has exactly one Geometry output with the original stable port id', () => {
    const node = new SphereNode()
    expect(Object.keys(node.outputs)).toEqual(['geometry'])
    const classes = classifyOutputPorts(node.outputs)
    expect(classes.main.map(([key]) => key)).toEqual(['geometry'])
    expect(classes.dynamicGeometry).toHaveLength(0)
  })

  it('Cylinder, Translate, Rotate, Scale, Difference, Union, and Intersection retain their intended ports', () => {
    const cylinder = new CylinderNode()
    expect(Object.keys(cylinder.inputs)).toEqual([])
    expect(Object.keys(cylinder.outputs)).toEqual(['geometry'])

    const translate = new TranslateNode()
    expect(Object.keys(translate.inputs)).toEqual(['geometry', 'x', 'y', 'z'])
    expect(Object.keys(translate.outputs)).toEqual(['geometry'])

    const rotate = new RotateNode()
    expect(Object.keys(rotate.inputs)).toEqual(['geometry', 'x', 'y', 'z'])
    expect(Object.keys(rotate.outputs)).toEqual(['geometry'])

    const scale = new ScaleNode()
    expect(Object.keys(scale.inputs)).toEqual(['geometry', 'x', 'y', 'z'])
    expect(Object.keys(scale.outputs)).toEqual(['geometry'])

    const difference = new DifferenceNode()
    expect(Object.keys(difference.inputs)).toEqual(['base', 'subtract'])
    expect(Object.keys(difference.outputs)).toEqual(['geometry'])

    const union = new UnionNode()
    expect(Object.keys(union.outputs)).toEqual(['geometry'])
    expect(Object.keys(union.inputs).every((key) => union.inputs[key]?.socket.name === 'geometry')).toBe(true)

    const intersection = new IntersectionNode()
    expect(Object.keys(intersection.outputs)).toEqual(['geometry'])
    expect(Object.keys(intersection.inputs).every((key) => intersection.inputs[key]?.socket.name === 'geometry')).toBe(true)

    for (const node of [cylinder, translate, rotate, scale, difference, union, intersection]) {
      const classes = classifyOutputPorts(node.outputs)
      expect(classes.main.map(([key]) => key)).toEqual(['geometry'])
      expect(classes.dynamicGeometry).toHaveLength(0)
    }
  })

  it('a Module Call result output is classified as the single main Geometry output, never a duplicate row', () => {
    const call = new ModuleCallNode({ id: 'wheel', name: 'wheel', parameters: [], geometryInputs: [] })
    expect(Object.keys(call.outputs)).toEqual(['geometry'])
    const classes = classifyOutputPorts(call.outputs)
    expect(classes.main.map(([key]) => key)).toEqual(['geometry'])
    expect(classes.dynamicGeometry).toHaveLength(0)
  })

  it('Module Output has no outputs at all (a sink, not a producer)', () => {
    const output = new ModuleOutputNode()
    expect(Object.keys(output.outputs)).toEqual([])
    expect(Object.keys(output.inputs)).toEqual(['geometry'])
  })

  it('creating/editing Module Geometry inputs classifies exactly the definition-owned dynamic ports, never a built-in node port', () => {
    const inputs = new ModuleInputsNode(
      [{ id: 'foo-id', name: 'foo', type: 'number', default: -2 }],
      [{ id: 'foobar-id', name: 'Foobar' }, { id: 'fnord-id', name: 'Fnord' }],
    )
    const cube = new CubeNode()

    const inputsClasses = classifyOutputPorts(inputs.outputs)
    expect(inputsClasses.main).toHaveLength(0)
    expect(inputsClasses.dynamicGeometry.map(([key]) => key)).toEqual(['geometry:foobar-id', 'geometry:fnord-id'])
    expect(inputsClasses.parameter.map(([key]) => key)).toEqual(['parameter:foo-id'])

    // Mutating the Module's signature must never mutate an unrelated Cube's ports.
    inputs.syncSignature(
      [{ id: 'foo-id', name: 'foo', type: 'number', default: -2 }],
      [{ id: 'foobar-id', name: 'Foobar' }, { id: 'fnord-id', name: 'Fnord' }, { id: 'baz-id', name: 'Baz' }],
    )
    expect(Object.keys(cube.outputs)).toEqual(['geometry'])
    expect(classifyOutputPorts(cube.outputs).dynamicGeometry).toHaveLength(0)
  })
})

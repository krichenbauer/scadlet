import { ClassicPreset, NodeEditor } from 'rete'
import { describe, expect, it } from 'vitest'

import { DefinitionRegistry } from './definitions'
import { scopeTransferProblem } from './scope-transfer'
import type { Schemes } from './schemes'
import { CubeNode } from './nodes/cube-node'
import { CylinderNode } from './nodes/cylinder-node'
import { DifferenceNode } from './nodes/difference-node'
import { IntersectionNode } from './nodes/intersection-node'
import { SphereNode } from './nodes/sphere-node'

describe('ordered Boolean Geometry inputs during scope transfer', () => {
  it('moves complete Difference and Intersection graphs with their stable dynamic ports', async () => {
    const editor = new NodeEditor<Schemes>()
    const registry = new DefinitionRegistry()
    registry.add({ id: 'module', kind: 'module', name: 'module_scope', inputsNodeId: 'inputs', outputNodeId: 'output', parameters: [], geometryInputs: [] })

    const cube = new CubeNode()
    const sphere = new SphereNode()
    const cylinder = new CylinderNode()
    const difference = new DifferenceNode()
    const intersection = new IntersectionNode()
    for (const node of [cube, sphere, cylinder, difference, intersection]) await editor.addNode(node)

    const connect = (source: ClassicPreset.Node, output: string, target: ClassicPreset.Node, input: string) =>
      editor.addConnection(new ClassicPreset.Connection(source, output, target, input) as Schemes['Connection'])
    await connect(cube, 'geometry', difference, 'base')
    await connect(sphere, 'geometry', difference, 'subtract')
    difference.synchronizeChildren(new Set(['base', 'subtract']))
    const differenceThird = Object.keys(difference.inputs).at(-1)!
    await connect(cylinder, 'geometry', difference, differenceThird)
    difference.synchronizeChildren(new Set(['base', 'subtract', differenceThird]))

    await connect(cube, 'geometry', intersection, 'a')
    await connect(sphere, 'geometry', intersection, 'b')
    intersection.synchronizeChildren(new Set(['a', 'b']))
    const intersectionThird = Object.keys(intersection.inputs).at(-1)!
    await connect(cylinder, 'geometry', intersection, intersectionThird)
    intersection.synchronizeChildren(new Set(['a', 'b', intersectionThird]))

    const moving = [cube, sphere, cylinder, difference, intersection].map((node) => node.id)
    expect(scopeTransferProblem(editor, registry, moving, 'module')).toBeNull()
    expect(Object.keys(difference.inputs)).toHaveLength(4)
    expect(Object.keys(intersection.inputs)).toHaveLength(4)
    expect(difference.isInputPort(differenceThird)).toBe(true)
    expect(intersection.isInputPort(intersectionThird)).toBe(true)
  })
})

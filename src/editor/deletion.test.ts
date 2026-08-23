import { ClassicPreset, NodeEditor } from 'rete'
import { DataflowEngine } from 'rete-engine'
import { describe, expect, it } from 'vitest'

import { evaluateOpenSCAD } from './evaluate'
import { removeNodeWithConnections } from './deletion'
import { CubeNode } from './nodes/cube-node'
import { CylinderNode } from './nodes/cylinder-node'
import { DifferenceNode } from './nodes/difference-node'
import type { Schemes } from './schemes'

function createGraph() {
  const editor = new NodeEditor<Schemes>()
  const engine = new DataflowEngine<Schemes>((node) => ({
    inputs: () => Object.keys(node.inputs),
    outputs: () => Object.keys(node.outputs),
  }))
  editor.use(engine)
  return { editor, engine }
}

describe('removeNodeWithConnections', () => {
  it('removes an unconnected node without touching the rest of the graph', async () => {
    const { editor } = createGraph()
    const cube = new CubeNode()
    const cylinder = new CylinderNode()
    await editor.addNode(cube)
    await editor.addNode(cylinder)

    await removeNodeWithConnections(editor, cube.id)

    expect(editor.getNode(cube.id)).toBeUndefined()
    expect(editor.getNodes()).toEqual([cylinder])
    expect(editor.getConnections()).toEqual([])
  })

  it('removes a node and every connection attached to it', async () => {
    const { editor } = createGraph()
    const cube = new CubeNode()
    const cylinder = new CylinderNode()
    const difference = new DifferenceNode()
    await editor.addNode(cube)
    await editor.addNode(cylinder)
    await editor.addNode(difference)

    const baseConnection = new ClassicPreset.Connection<ClassicPreset.Node, ClassicPreset.Node>(
      cube,
      'geometry',
      difference,
      'base',
    )
    const subtractConnection = new ClassicPreset.Connection<ClassicPreset.Node, ClassicPreset.Node>(
      cylinder,
      'geometry',
      difference,
      'subtract',
    )
    await editor.addConnection(baseConnection)
    await editor.addConnection(subtractConnection)

    await removeNodeWithConnections(editor, difference.id)

    expect(editor.getNode(difference.id)).toBeUndefined()
    expect(editor.getConnections()).toEqual([])
    // The nodes that fed the deleted node are untouched.
    expect(editor.getNodes().map((node) => node.id).sort()).toEqual([cube.id, cylinder.id].sort())
  })

  it('leaves connections between remaining nodes intact', async () => {
    const { editor } = createGraph()
    const cube = new CubeNode()
    const cylinder = new CylinderNode()
    const difference = new DifferenceNode()
    await editor.addNode(cube)
    await editor.addNode(cylinder)
    await editor.addNode(difference)

    const baseConnection = new ClassicPreset.Connection<ClassicPreset.Node, ClassicPreset.Node>(
      cube,
      'geometry',
      difference,
      'base',
    )
    const subtractConnection = new ClassicPreset.Connection<ClassicPreset.Node, ClassicPreset.Node>(
      cylinder,
      'geometry',
      difference,
      'subtract',
    )
    await editor.addConnection(baseConnection)
    await editor.addConnection(subtractConnection)

    // An unrelated, unconnected node shouldn't be affected by deleting cylinder.
    await removeNodeWithConnections(editor, cylinder.id)

    expect(editor.getNode(cylinder.id)).toBeUndefined()
    // Only the connection touching cylinder is gone; cube -> difference stays.
    expect(editor.getConnections().map((connection) => connection.id)).toEqual([baseConnection.id])
    expect(editor.getNodes().map((node) => node.id).sort()).toEqual([cube.id, difference.id].sort())
  })

  it('evaluates correctly afterwards and does not reference the removed node', async () => {
    const { editor, engine } = createGraph()
    const cube = new CubeNode()
    const cylinder = new CylinderNode()
    const difference = new DifferenceNode()
    await editor.addNode(cube)
    await editor.addNode(cylinder)
    await editor.addNode(difference)

    await editor.addConnection(
      new ClassicPreset.Connection<ClassicPreset.Node, ClassicPreset.Node>(
        cube,
        'geometry',
        difference,
        'base',
      ),
    )
    await editor.addConnection(
      new ClassicPreset.Connection<ClassicPreset.Node, ClassicPreset.Node>(
        cylinder,
        'geometry',
        difference,
        'subtract',
      ),
    )

    // Deleting the composing node also removes its connections, so cube
    // and cylinder become independent roots again instead of leaving a
    // dangling reference to the removed difference node.
    await removeNodeWithConnections(editor, difference.id)

    const source = await evaluateOpenSCAD(editor, engine)

    expect(source).toContain('cube(')
    expect(source).toContain('cylinder(')
    expect(source).not.toContain('difference(')
  })
})

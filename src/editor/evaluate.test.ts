import { NodeEditor } from 'rete'
import { DataflowEngine } from 'rete-engine'
import { describe, expect, it } from 'vitest'

import { evaluateOpenSCAD } from './evaluate'
import { CubeNode } from './nodes/cube-node'
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

describe('evaluateOpenSCAD', () => {
  it('returns an empty string for a graph with zero nodes, without throwing', async () => {
    // This is the state a fresh SCADlet session now starts in (the
    // automatic startup Cube was removed) and also what clicking "Render"
    // against an empty canvas evaluates - must never crash.
    const { editor, engine } = createGraph()

    const source = await evaluateOpenSCAD(editor, engine)

    expect(source).toBe('')
  })

  it('still evaluates a graph with an explicitly added node normally', async () => {
    const { editor, engine } = createGraph()
    await editor.addNode(new CubeNode())

    const source = await evaluateOpenSCAD(editor, engine)

    expect(source).toBe('cube(10);')
  })
})

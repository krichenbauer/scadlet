import { ClassicPreset, NodeEditor } from 'rete'
import { describe, expect, it } from 'vitest'

import { graphEndpointsAreValid, guardPortRemoval, removeInputSafely } from './port-lifecycle'
import type { Schemes } from './schemes'
import { numberSocket } from './sockets'

function connectedGraph() {
  const editor = new NodeEditor<Schemes>()
  const source = new ClassicPreset.Node('Number')
  source.addOutput('value', new ClassicPreset.Output(numberSocket, 'Number'))
  const target = new ClassicPreset.Node('Target')
  target.addInput('value', new ClassicPreset.Input(numberSocket, 'Value'))
  return { editor, source: source as Schemes['Node'], target: target as Schemes['Node'] }
}

describe('dynamic port lifecycle', () => {
  it('removes a connected input only after removing its Rete connection', async () => {
    const { editor, source, target } = connectedGraph()
    await editor.addNode(source)
    await editor.addNode(target)
    guardPortRemoval(editor, target)
    await editor.addConnection(new ClassicPreset.Connection(source, 'value', target, 'value') as Schemes['Connection'])

    await expect(removeInputSafely(editor, target.id, 'value')).resolves.toBe(true)
    expect(editor.getConnections()).toEqual([])
    expect(target.inputs.value).toBeUndefined()
    expect(graphEndpointsAreValid(editor)).toBe(true)
  })

  it('rejects unsafe direct removal while a connection is attached', async () => {
    const { editor, source, target } = connectedGraph()
    await editor.addNode(source)
    await editor.addNode(target)
    guardPortRemoval(editor, target)
    await editor.addConnection(new ClassicPreset.Connection(source, 'value', target, 'value') as Schemes['Connection'])

    expect(() => target.removeInput('value')).toThrow('removeInputSafely')
    expect(graphEndpointsAreValid(editor)).toBe(true)
  })
})

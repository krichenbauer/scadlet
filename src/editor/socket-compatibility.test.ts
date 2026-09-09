import { ClassicPreset, NodeEditor } from 'rete'
import { describe, expect, it } from 'vitest'

import { attachSocketCompatibilityGuard } from './editor'
import type { Schemes } from './schemes'
import { booleanSocket, geometrySocket, numberSocket, vector3Socket } from './sockets'
import { canConnectSocketData } from './connection-compatibility'
import { ConditionalNode, NumberNode, BooleanNode, Vector3Node } from './nodes/value-nodes'

const sockets = { geometry: geometrySocket, number: numberSocket, vector3: vector3Socket, boolean: booleanSocket } as const
type SocketName = keyof typeof sockets

class TypedSource extends ClassicPreset.Node {
  constructor() {
    super('Test source')
    for (const [name, socket] of Object.entries(sockets) as [SocketName, ClassicPreset.Socket][]) {
      this.addOutput(name, new ClassicPreset.Output(socket, name))
    }
  }
}

class TypedTarget extends ClassicPreset.Node {
  constructor() {
    super('Test target')
    for (const [name, socket] of Object.entries(sockets) as [SocketName, ClassicPreset.Socket][]) {
      this.addInput(name, new ClassicPreset.Input(socket, name))
    }
  }
}

describe('semantic socket compatibility', () => {
  it('allows only the diagonal of the complete 4×4 socket matrix before graph mutation', async () => {
    for (const sourceType of Object.keys(sockets) as SocketName[]) {
      for (const targetType of Object.keys(sockets) as SocketName[]) {
        const editor = new NodeEditor<Schemes>()
        attachSocketCompatibilityGuard(editor)
        const source = new TypedSource()
        const target = new TypedTarget()
        await editor.addNode(source as unknown as Schemes['Node'])
        await editor.addNode(target as unknown as Schemes['Node'])
        const created = await editor.addConnection(new ClassicPreset.Connection(source, sourceType, target, targetType) as Schemes['Connection'])
        expect(created, `${sourceType} → ${targetType}`).toBe(sourceType === targetType)
        expect(editor.getConnections()).toHaveLength(sourceType === targetType ? 1 : 0)
      }
    }
  })

  it('still accepts an ordinary Geometry graph connection', async () => {
    const editor = new NodeEditor<Schemes>()
    attachSocketCompatibilityGuard(editor)
    const source = new TypedSource()
    const target = new TypedTarget()
    await editor.addNode(source as unknown as Schemes['Node'])
    await editor.addNode(target as unknown as Schemes['Node'])
    expect(await editor.addConnection(new ClassicPreset.Connection(source, 'geometry', target, 'geometry') as Schemes['Connection'])).toBe(true)
  })

  it('keeps the Conditional branch transition exception narrow and value-only', async () => {
    const editor = new NodeEditor<Schemes>()
    const conditional = new ConditionalNode()
    const number = new NumberNode()
    const boolean = new BooleanNode()
    const vector = new Vector3Node()
    const geometry = new TypedSource()
    for (const node of [conditional, number, boolean, vector, geometry]) await editor.addNode(node as Schemes['Node'])
    for (const node of [number, boolean, vector]) {
      expect(canConnectSocketData(editor, { nodeId: node.id, key: 'value', side: 'output' }, { nodeId: conditional.id, key: 'true', side: 'input' })).toBe(true)
    }
    expect(canConnectSocketData(editor, { nodeId: geometry.id, key: 'geometry', side: 'output' }, { nodeId: conditional.id, key: 'true', side: 'input' })).toBe(false)
    expect(canConnectSocketData(editor, { nodeId: number.id, key: 'value', side: 'output' }, { nodeId: conditional.id, key: 'condition', side: 'input' })).toBe(false)
  })
})

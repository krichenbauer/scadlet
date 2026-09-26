import { ClassicPreset, NodeEditor } from 'rete'
import { describe, expect, it } from 'vitest'

import { DefinitionRegistry } from './definitions'
import { scopeTransferProblem } from './scope-transfer'
import type { Schemes } from './schemes'
import { ForHeaderNode, ForResultNode } from './nodes/for-nodes'
import { VariableReferenceNode } from './nodes/variable-reference-node'

describe('For scope transfer', () => {
  it('never splits a pair and requires its iterator references to move with it', async () => {
    const editor = new NodeEditor<Schemes>()
    const registry = new DefinitionRegistry()
    registry.add({ id: 'module', kind: 'module', name: 'module_scope', inputsNodeId: 'inputs', outputNodeId: 'output', parameters: [], geometryInputs: [] })
    const header = new ForHeaderNode({ pairId: 'pair', bindingId: 'iterator', name: 'i', start: 0, step: 1, end: 10 })
    const result = new ForResultNode({ pairId: 'pair', children: [{ id: 'body' }] })
    const reference = new VariableReferenceNode({ bindingId: 'iterator' }, { id: 'iterator', name: 'i', type: 'number' })
    for (const node of [header, result, reference]) await editor.addNode(node)
    await editor.addConnection(new ClassicPreset.Connection(header, 'loop', result, 'loop') as Schemes['Connection'])

    expect(scopeTransferProblem(editor, registry, [header.id], 'module')).toBe('loop-pair')
    expect(scopeTransferProblem(editor, registry, [header.id, result.id], 'module')).toBe('variable-reference')
    expect(scopeTransferProblem(editor, registry, [header.id, result.id, reference.id], 'module')).toBeNull()
  })

  it('rejects a pair whose iterator would shadow a binding in the destination', async () => {
    const editor = new NodeEditor<Schemes>()
    const registry = new DefinitionRegistry()
    registry.add({
      id: 'module', kind: 'module', name: 'module_scope', inputsNodeId: 'inputs', outputNodeId: 'output',
      parameters: [{ id: 'parameter', name: 'i', type: 'number', default: 0 }], geometryInputs: [],
    })
    const header = new ForHeaderNode({ pairId: 'pair', bindingId: 'iterator', name: 'i', start: 0, step: 1, end: 10 })
    const result = new ForResultNode({ pairId: 'pair', children: [{ id: 'body' }] })
    await editor.addNode(header)
    await editor.addNode(result)
    await editor.addConnection(new ClassicPreset.Connection(header, 'loop', result, 'loop') as Schemes['Connection'])

    expect(scopeTransferProblem(editor, registry, [header.id, result.id], 'module')).toBe('binding-conflict')
  })
})

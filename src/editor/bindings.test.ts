import { ClassicPreset, NodeEditor } from 'rete'
import { describe, expect, it } from 'vitest'

import { bindingNamesInScope, reservedBindingNamesInScope } from './bindings'
import { bindDefinitionRegistry, DefinitionRegistry } from './definitions'
import { ForHeaderNode, ForResultNode } from './nodes/for-nodes'
import { NumberNode } from './nodes/value-nodes'
import type { Schemes } from './schemes'
import { serializeProject } from '../persistence/serialize'
import { parseScadletProject } from '../persistence/validate'

async function mainWithLoop() {
  const editor = new NodeEditor<Schemes>()
  const definitions = new DefinitionRegistry()
  bindDefinitionRegistry(editor, definitions)
  const header = new ForHeaderNode({ pairId: 'pair', bindingId: 'iterator', name: 'i', start: 0, step: 1, end: 3 })
  const result = new ForResultNode({ pairId: 'pair', children: [{ id: 'body' }] })
  const value = new NumberNode({ value: 2, name: 'n' })
  value.renameBinding('n')
  await editor.addNode(header)
  await editor.addNode(result)
  await editor.addNode(value)
  await editor.addConnection(new ClassicPreset.Connection(header, 'loop', result, 'loop') as Schemes['Connection'])
  return { editor, definitions, header, value }
}

function saved(editor: NodeEditor<Schemes>) {
  return serializeProject({
    editor,
    metadata: { name: 'Names' },
    getNodePosition: () => ({ x: 0, y: 0 }),
    viewport: { x: 0, y: 0, k: 1 },
    viewerCamera: { position: [80, 80, 60], target: [0, 0, 0] },
  })
}

describe('reserved binding names', () => {
  it('adds the scope iterators to the Value and parameter names, only for Value/parameter naming', async () => {
    const { editor, definitions, value, header } = await mainWithLoop()
    expect(bindingNamesInScope(editor, definitions, null)).toEqual(['n'])
    expect(reservedBindingNamesInScope(editor, definitions, null)).toEqual(['n', 'i'])
    // Excluding a binding's own id lets it keep its current name.
    expect(reservedBindingNamesInScope(editor, definitions, null, value.getBindingId())).toEqual(['i'])
    expect(reservedBindingNamesInScope(editor, definitions, null, header.bindingId)).toEqual(['n'])
    // Another scope is independent.
    definitions.add({ id: 'shape', kind: 'module', name: 'shape', inputsNodeId: 'shape-in', outputNodeId: 'shape-out', parameters: [{ id: 'size', name: 'size', type: 'number', default: 1 }], geometryInputs: [] })
    expect(reservedBindingNamesInScope(editor, definitions, 'shape')).toEqual(['size'])
  })

  it('matches the saved-format rule: reserved names fail validation, free names save', async () => {
    const { editor, definitions, value } = await mainWithLoop()
    expect(() => parseScadletProject(saved(editor))).not.toThrow()
    for (const taken of reservedBindingNamesInScope(editor, definitions, null, value.getBindingId())) {
      value.renameBinding(taken)
      expect(() => parseScadletProject(saved(editor))).toThrow()
    }
    value.renameBinding('spacing')
    expect(reservedBindingNamesInScope(editor, definitions, null, value.getBindingId())).not.toContain('spacing')
    expect(() => parseScadletProject(saved(editor))).not.toThrow()
  })
})

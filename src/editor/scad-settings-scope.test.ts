import { NodeEditor } from 'rete'
import { describe, expect, it } from 'vitest'

import { DefinitionRegistry } from './definitions'
import { scopeTransferProblem } from './scope-transfer'
import type { Schemes } from './schemes'
import { ScadSettingsNode } from './nodes/scad-settings-node'

describe('SCAD settings scope rules', () => {
  it('allows one node in Main and each Module but rejects Function transfer and duplicate target scope', async () => {
    const editor = new NodeEditor<Schemes>()
    const definitions = new DefinitionRegistry()
    definitions.add({ id: 'module', kind: 'module', name: 'part', inputsNodeId: 'module-in', outputNodeId: 'module-out', parameters: [], geometryInputs: [] })
    definitions.add({ id: 'function', kind: 'function', name: 'detail', inputsNodeId: 'function-in', outputNodeId: 'function-out', parameters: [] })
    const main = new ScadSettingsNode(); main.id = 'main-settings'
    const local = new ScadSettingsNode(); local.id = 'module-settings'
    const candidate = new ScadSettingsNode(); candidate.id = 'candidate-settings'
    for (const node of [main, local, candidate]) await editor.addNode(node)
    definitions.assignNode('module', local.id)

    expect(scopeTransferProblem(editor, definitions, [candidate.id], 'function')).toBe('function-incompatible')
    expect(scopeTransferProblem(editor, definitions, [candidate.id], 'module')).toBe('settings-duplicate')
    expect(scopeTransferProblem(editor, definitions, [candidate.id], null)).toBe('settings-duplicate')
  })
})

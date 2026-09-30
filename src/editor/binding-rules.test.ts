import { ClassicPreset, NodeEditor } from 'rete'
import { describe, expect, it } from 'vitest'

import { bindingNamesInScope, reservedBindingNamesInScope, resolveBindingInScope } from './bindings'
import { bindDefinitionRegistry, DefinitionRegistry } from './definitions'
import { ForHeaderNode, ForResultNode } from './nodes/for-nodes'
import { NumberNode, Vector3Node } from './nodes/value-nodes'
import { VariableReferenceNode } from './nodes/variable-reference-node'
import type { Schemes } from './schemes'
import { scopeTransferProblem } from './scope-transfer'
import { parseScadletProject } from '../persistence/validate'

/** Main: Value `a` (bound), label-only Value, For `i`, a reference to `a`.
 * Module `shape`: parameter `p`, Vector3 Value `v`, For `j`, a reference to `p`. */
async function scopes() {
  const editor = new NodeEditor<Schemes>()
  const definitions = new DefinitionRegistry()
  bindDefinitionRegistry(editor, definitions)
  definitions.add({ id: 'shape', kind: 'module', name: 'shape', inputsNodeId: 'shape-in', outputNodeId: 'shape-out', parameters: [{ id: 'p-id', name: 'p', type: 'number', default: 1 }], geometryInputs: [] })
  const a = new NumberNode({ value: 1, name: 'a', bindingId: 'a-id' }); a.id = 'a'
  const label = new NumberNode({ value: 2, name: 'Number' }); label.id = 'label'
  const i = new ForHeaderNode({ pairId: 'pi', bindingId: 'i-id', name: 'i', start: 0, step: 1, end: 3 }); i.id = 'i'
  const iResult = new ForResultNode({ pairId: 'pi', children: [{ id: 'body' }] }); iResult.id = 'i-result'
  const refA = new VariableReferenceNode({ bindingId: 'a-id' }, { id: 'a-id', name: 'a', type: 'number' }); refA.id = 'ref-a'
  const v = new Vector3Node({ x: 0, y: 0, z: 0, name: 'v', bindingId: 'v-id' }); v.id = 'v'
  const j = new ForHeaderNode({ pairId: 'pj', bindingId: 'j-id', name: 'j', start: 0, step: 1, end: 3 }); j.id = 'j'
  const jResult = new ForResultNode({ pairId: 'pj', children: [{ id: 'body' }] }); jResult.id = 'j-result'
  const refP = new VariableReferenceNode({ bindingId: 'p-id' }, { id: 'p-id', name: 'p', type: 'number' }); refP.id = 'ref-p'
  for (const node of [a, label, i, iResult, refA, v, j, jResult, refP]) await editor.addNode(node)
  for (const id of ['v', 'j', 'j-result', 'ref-p']) definitions.assignNode('shape', id)
  await editor.addConnection(new ClassicPreset.Connection(i, 'loop', iResult, 'loop') as Schemes['Connection'])
  await editor.addConnection(new ClassicPreset.Connection(j, 'loop', jResult, 'loop') as Schemes['Connection'])
  return { editor, definitions, a, v, i, j }
}

const envelope = (nodes: unknown[], connections: unknown[] = []) => ({
  format: 'scadlet', version: 8, metadata: { name: 'Bindings' }, definitions: [],
  graph: { nodes, connections },
  editor: { viewport: { x: 0, y: 0, zoom: 1 } }, viewer: { camera: { position: [80, 80, 60], target: [0, 0, 0] } },
})
const value = (id: string, name: string, bindingId?: unknown) => ({ id, type: 'number', position: { x: 0, y: 0 }, parameters: { value: 1, name, ...(bindingId === undefined ? {} : { bindingId }) } })
const loop = (id: string, name: string, bindingId = `${id}-id`) => [
  { id, type: 'for', position: { x: 0, y: 0 }, parameters: { pairId: `${id}-pair`, bindingId, name, start: 0, step: 1, end: 3 } },
  { id: `${id}-result`, type: 'for-result', position: { x: 0, y: 0 }, parameters: { pairId: `${id}-pair`, children: [{ id: 'body' }] } },
]
const boundary = (id: string) => ({ id: `${id}-boundary`, source: id, sourceOutput: 'loop', target: `${id}-result`, targetInput: 'loop' })
const reference = (id: string, bindingId: string) => ({ id, type: 'variable-reference', position: { x: 0, y: 0 }, parameters: { bindingId } })

describe('binding rules (characterization of every current copy)', () => {
  it('lists names per scope for Values/parameters, and additionally iterators for reserved names', async () => {
    const { editor, definitions } = await scopes()
    expect(bindingNamesInScope(editor, definitions, null)).toEqual(['a'])
    expect(reservedBindingNamesInScope(editor, definitions, null)).toEqual(['a', 'i'])
    expect(bindingNamesInScope(editor, definitions, 'shape')).toEqual(['v', 'p'])
    expect(reservedBindingNamesInScope(editor, definitions, 'shape')).toEqual(['v', 'p', 'j'])
    expect(reservedBindingNamesInScope(editor, definitions, 'shape', 'p-id')).toEqual(['v', 'j'])
    expect(reservedBindingNamesInScope(editor, definitions, null, 'i-id')).toEqual(['a'])
  })

  it('resolves references by id within exactly one scope', async () => {
    const { editor, definitions } = await scopes()
    expect(resolveBindingInScope(editor, definitions, 'a-id', null)).toEqual({ id: 'a-id', name: 'a', type: 'number' })
    expect(resolveBindingInScope(editor, definitions, 'i-id', null)).toEqual({ id: 'i-id', name: 'i', type: 'number' })
    expect(resolveBindingInScope(editor, definitions, 'v-id', 'shape')).toEqual({ id: 'v-id', name: 'v', type: 'vector3' })
    expect(resolveBindingInScope(editor, definitions, 'p-id', 'shape')).toEqual({ id: 'p-id', name: 'p', type: 'number' })
    expect(resolveBindingInScope(editor, definitions, 'a-id', 'shape')).toBeUndefined()
    expect(resolveBindingInScope(editor, definitions, 'p-id', null)).toBeUndefined()
    expect(resolveBindingInScope(editor, definitions, 'label', null)).toBeUndefined()
    expect(resolveBindingInScope(editor, undefined, 'a-id', null)).toEqual({ id: 'a-id', name: 'a', type: 'number' })
  })

  it('preflights scope transfers with name conflicts before unresolved references', async () => {
    const { editor, definitions, a, v } = await scopes()
    // Moving `a` alone leaves its reference behind in Main.
    expect(scopeTransferProblem(editor, definitions, ['a'], 'shape')).toBe('variable-reference')
    expect(scopeTransferProblem(editor, definitions, ['a', 'ref-a'], 'shape')).toBeNull()
    expect(scopeTransferProblem(editor, definitions, ['ref-p'], null)).toBe('variable-reference')
    // A Value taking the parameter's name in the Module conflicts; this
    // conflict wins over the reference `a` leaves behind.
    a.renameBinding('p')
    expect(scopeTransferProblem(editor, definitions, ['a'], 'shape')).toBe('binding-conflict')
    a.renameBinding('a')
    // An iterator entering a scope with a same-named Value conflicts.
    v.renameBinding('i')
    expect(scopeTransferProblem(editor, definitions, ['i', 'i-result'], 'shape')).toBe('binding-conflict')
  })

  it('validates files with the same rules and reports the first problem', () => {
    const accept = (nodes: unknown[], connections: unknown[] = []) => expect(() => parseScadletProject(envelope(nodes, connections))).not.toThrow()
    const reject = (message: string, nodes: unknown[], connections: unknown[] = []) => expect(() => parseScadletProject(envelope(nodes, connections))).toThrow(message)
    accept([value('a', 'a', 'a-id'), value('b', 'Number'), ...loop('i', 'i'), ...loop('k', 'i'), reference('r', 'a-id'), reference('ri', 'i-id')], [boundary('i'), boundary('k')])
    reject('Value node "b" has an invalid variable binding.', [value('b', 'not valid', 'b-id')])
    // A non-string binding id is already refused by the Value's own parameter validator.
    reject('Invalid parameters for node "b" (number): Invalid parameters: "bindingId" must be a non-empty string', [value('b', 'b', 7)])
    reject('Duplicate variable binding id "x" in one scope.', [value('a', 'a', 'x'), value('b', 'b', 'x')])
    reject('Duplicate binding name "a" in one scope.', [value('a', 'a', 'a-id'), value('b', 'a', 'b-id')])
    reject('Duplicate variable binding id "x" in one scope.', [value('a', 'a', 'x'), ...loop('i', 'i', 'x')], [boundary('i')])
    reject('For iterator "a" collides with a binding visible from its enclosing scope.', [value('a', 'a', 'a-id'), ...loop('i', 'a')], [boundary('i')])
    reject('Variable reference node "r" has a missing, stale, or cross-scope binding "gone".', [reference('r', 'gone')])
    // Precedence: the Value problem is reported before a later iterator problem.
    reject('Duplicate binding name "a" in one scope.', [value('a', 'a', 'a-id'), value('b', 'a', 'b-id'), ...loop('i', 'a')], [boundary('i')])
  })
})

import { describe, expect, it } from 'vitest'

import { enclosingBindingNames, reservedBindingNames, resolveScopeBinding, scopeBindingProblem, scopeBindings, type BindingRecord } from './scope-bindings'

const parameters = [{ id: 'p-id', name: 'p', type: 'boolean' as const, default: false }]
const records: BindingRecord[] = [
  { id: 'i', type: 'for', parameters: { bindingId: 'i-id', name: 'i' } },
  { id: 'a', type: 'number', parameters: { bindingId: 'a-id', name: 'a' } },
  { id: 'label', type: 'vector3', parameters: { name: 'Vector3' } },
  { id: 'v', type: 'vector3', parameters: { bindingId: 'v-id', name: 'v' } },
  { id: 'r', type: 'variable-reference', parameters: { bindingId: 'a-id' } },
  { id: 'cube', type: 'cube', parameters: {} },
]

describe('scope bindings', () => {
  it('lists Values, then parameters, then iterators, and skips label-only Values', () => {
    expect(scopeBindings(records, parameters)).toEqual([
      { id: 'a-id', name: 'a', type: 'number', kind: 'value' },
      { id: 'v-id', name: 'v', type: 'vector3', kind: 'value' },
      { id: 'p-id', name: 'p', type: 'boolean', kind: 'parameter' },
      { id: 'i-id', name: 'i', type: 'number', kind: 'iterator' },
    ])
  })

  it('resolves by id and separates the enclosing names from all reserved names', () => {
    const table = scopeBindings(records, parameters)
    expect(resolveScopeBinding(table, 'p-id')).toEqual({ id: 'p-id', name: 'p', type: 'boolean' })
    expect(resolveScopeBinding(table, 'missing')).toBeUndefined()
    expect(enclosingBindingNames(table)).toEqual(['a', 'v', 'p'])
    expect(reservedBindingNames(table)).toEqual(['a', 'v', 'p', 'i'])
    expect(reservedBindingNames(table, 'a-id')).toEqual(['v', 'p', 'i'])
  })

  it('reports the first rule violation in Value, iterator, reference order', () => {
    expect(scopeBindingProblem(records, parameters)).toBeNull()
    expect(scopeBindingProblem([{ id: 'x', type: 'number', parameters: { bindingId: 'x-id', name: '1bad' } }], [])).toEqual({ code: 'invalid-value', nodeId: 'x' })
    expect(scopeBindingProblem([{ id: 'x', type: 'boolean', parameters: { bindingId: 'p-id', name: 'x' } }], parameters)).toEqual({ code: 'duplicate-id', bindingId: 'p-id' })
    expect(scopeBindingProblem([{ id: 'x', type: 'boolean', parameters: { bindingId: 'x-id', name: 'p' } }], parameters)).toEqual({ code: 'duplicate-name', name: 'p' })
    expect(scopeBindingProblem([{ id: 'f', type: 'for', parameters: { bindingId: 'f-id' } }], [])).toEqual({ code: 'invalid-iterator', nodeId: 'f' })
    expect(scopeBindingProblem([{ id: 'f', type: 'for', parameters: { bindingId: 'f-id', name: 'p' } }], parameters)).toEqual({ code: 'iterator-name', name: 'p' })
    expect(scopeBindingProblem([{ id: 'r', type: 'variable-reference', parameters: { bindingId: 'gone' } }], [])).toEqual({ code: 'missing-reference', nodeId: 'r', bindingId: 'gone' })
    // Sibling iterators may share a name; only their ids must differ.
    expect(scopeBindingProblem([
      { id: 'f', type: 'for', parameters: { bindingId: 'f-id', name: 'i' } },
      { id: 'g', type: 'for', parameters: { bindingId: 'g-id', name: 'i' } },
    ], [])).toBeNull()
  })
})

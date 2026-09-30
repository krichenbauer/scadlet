import { isOpenSCADIdentifier, type ModuleParameter } from './definitions'
import { isValueType, valueNodeType, type ValueType } from './value-types'

/**
 * The single authority for named bindings within one semantic scope: which
 * bindings exist, which names they take, how a reference resolves, and
 * whether the scope satisfies the naming rules. It works on plain node
 * records (the `.scadlet` shape), so file validation, restore, the clipboard,
 * and the live editor (through small adapters) share one implementation.
 */

/** A node as the binding rules see it: catalog type plus parameters. */
export interface BindingRecord {
  id: string
  type: string
  parameters: Record<string, unknown>
}

export type BindingKind = 'value' | 'parameter' | 'iterator'

export interface ScopeBinding {
  id: string
  name: string
  type: ValueType
  kind: BindingKind
}

/** The scope's bindings in a fixed order: bound Values (record order),
 * definition parameters, then For iterators (record order). Label-only Values
 * without a binding id are not bindings. */
export function scopeBindings(records: readonly BindingRecord[], parameters: readonly ModuleParameter[]): ScopeBinding[] {
  const values = records.flatMap((record) => {
    const type = valueNodeType(record.type)
    const bindingId = record.parameters.bindingId
    return type && typeof bindingId === 'string' ? [{ id: bindingId, name: String(record.parameters.name), type, kind: 'value' as const }] : []
  })
  const params = parameters.map((parameter) => ({ id: parameter.id, name: parameter.name, type: parameter.type, kind: 'parameter' as const }))
  const iterators = records.flatMap((record) => {
    const bindingId = record.parameters.bindingId
    return record.type === 'for' && typeof bindingId === 'string'
      ? [{ id: bindingId, name: String(record.parameters.name), type: 'number' as const, kind: 'iterator' as const }]
      : []
  })
  return [...values, ...params, ...iterators]
}

/** Resolves a reference strictly by id within this scope's table. */
export function resolveScopeBinding(bindings: readonly ScopeBinding[], id: string): { id: string; name: string; type: ValueType } | undefined {
  const found = bindings.find((binding) => binding.id === id && binding.kind === 'iterator')
    ?? bindings.find((binding) => binding.id === id && binding.kind === 'value')
    ?? bindings.find((binding) => binding.id === id && binding.kind === 'parameter')
  return found ? { id: found.id, name: found.name, type: found.type } : undefined
}

/** Names of Values and parameters: the names visible around a For loop, and
 * the names an iterator may not take (sibling iterators may share names). */
export function enclosingBindingNames(bindings: readonly ScopeBinding[], excludeBindingId?: string): string[] {
  return bindings.filter((binding) => binding.kind !== 'iterator' && binding.id !== excludeBindingId).map((binding) => binding.name)
}

/** Every binding name of the scope: the names a Value or parameter may not take. */
export function reservedBindingNames(bindings: readonly ScopeBinding[], excludeBindingId?: string): string[] {
  return bindings.filter((binding) => binding.id !== excludeBindingId).map((binding) => binding.name)
}

export type ScopeBindingProblem =
  | { code: 'invalid-value'; nodeId: string }
  | { code: 'duplicate-id'; bindingId: string }
  | { code: 'duplicate-name'; name: string }
  | { code: 'invalid-iterator'; nodeId: string }
  | { code: 'iterator-name'; name: string }
  | { code: 'missing-reference'; nodeId: string; bindingId: string }

/**
 * The first violation of the scope's naming rules, checked in a fixed order:
 * each bound Value (valid identifier, unique id, unique among Values and
 * parameters), then each iterator (valid identifier, unique id, not a Value or
 * parameter name), then each reference (resolves in this scope).
 */
export function scopeBindingProblem(records: readonly BindingRecord[], parameters: readonly ModuleParameter[]): ScopeBindingProblem | null {
  const ids = new Set(parameters.map((parameter) => parameter.id))
  const names = new Set(parameters.map((parameter) => parameter.name))
  for (const record of records) {
    if (!isValueType(record.type)) continue
    const bindingId = record.parameters.bindingId
    if (bindingId === undefined) continue
    const name = record.parameters.name
    if (typeof bindingId !== 'string' || !bindingId || typeof name !== 'string' || !isOpenSCADIdentifier(name)) return { code: 'invalid-value', nodeId: record.id }
    if (ids.has(bindingId)) return { code: 'duplicate-id', bindingId }
    if (names.has(name)) return { code: 'duplicate-name', name }
    ids.add(bindingId)
    names.add(name)
  }
  for (const record of records) {
    if (record.type !== 'for') continue
    const bindingId = record.parameters.bindingId
    const name = record.parameters.name
    if (typeof bindingId !== 'string' || !bindingId || typeof name !== 'string' || !isOpenSCADIdentifier(name)) return { code: 'invalid-iterator', nodeId: record.id }
    if (ids.has(bindingId)) return { code: 'duplicate-id', bindingId }
    if (names.has(name)) return { code: 'iterator-name', name }
    ids.add(bindingId)
  }
  for (const record of records) {
    if (record.type !== 'variable-reference') continue
    const bindingId = String(record.parameters.bindingId)
    if (!ids.has(bindingId)) return { code: 'missing-reference', nodeId: record.id, bindingId }
  }
  return null
}

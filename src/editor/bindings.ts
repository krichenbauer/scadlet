import type { NodeEditor } from 'rete'

import type { DefinitionRegistry, ModuleParameterType } from './definitions'
import { BooleanNode, NumberNode, Vector3Node } from './nodes/value-nodes'
import { VariableReferenceNode, type VariableBindingResolution } from './nodes/variable-reference-node'
import type { Schemes } from './schemes'
import { ForHeaderNode } from './nodes/for-nodes'
import { enclosingBindingNames, reservedBindingNames, resolveScopeBinding, scopeBindings, type BindingRecord, type ScopeBinding } from './scope-bindings'

export type ValueBindingNode = NumberNode | BooleanNode | Vector3Node

export function isValueBindingNode(node: Schemes['Node'] | undefined): node is ValueBindingNode {
  return node instanceof NumberNode || node instanceof BooleanNode || node instanceof Vector3Node
}

export function valueBindingType(node: ValueBindingNode): ModuleParameterType {
  return node instanceof NumberNode ? 'number' : node instanceof BooleanNode ? 'boolean' : 'vector3'
}

/** The live nodes of one scope as binding records. `scopeOf` may describe a
 * hypothetical assignment (scope transfer preflight). Only binding-relevant
 * nodes are read, so this stays cheap for frequent lookups. */
export function liveBindingRecords(
  editor: NodeEditor<Schemes>,
  scopeOf: (nodeId: string) => string | null,
  scope: string | null,
): BindingRecord[] {
  return editor.getNodes().filter((node) => scopeOf(node.id) === scope).flatMap((node): BindingRecord[] => {
    if (isValueBindingNode(node)) {
      const bindingId = node.getBindingId()
      return [{ id: node.id, type: valueBindingType(node), parameters: bindingId === undefined ? {} : { bindingId, name: node.getBindingName() } }]
    }
    if (node instanceof ForHeaderNode) return [{ id: node.id, type: 'for', parameters: { bindingId: node.bindingId, name: node.getBindingName() } }]
    if (node instanceof VariableReferenceNode) return [{ id: node.id, type: 'variable-reference', parameters: { bindingId: node.bindingId } }]
    return []
  })
}

/** The binding table of one live scope (`null` is Main). */
export function liveScopeBindings(
  editor: NodeEditor<Schemes>,
  definitions: DefinitionRegistry | undefined,
  scope: string | null,
): ScopeBinding[] {
  const parameters = scope === null ? [] : definitions?.get(scope)?.parameters ?? []
  return scopeBindings(liveBindingRecords(editor, (nodeId) => definitions?.scopeOf(nodeId) ?? null, scope), parameters)
}

/** Resolves identity only within the requested semantic scope. The same
 * spelling and even the same imported parameter id may exist independently in
 * other scopes without capture. */
export function resolveBindingInScope(
  editor: NodeEditor<Schemes>,
  definitions: DefinitionRegistry | undefined,
  bindingId: string,
  scope: string | null,
): VariableBindingResolution | undefined {
  return resolveScopeBinding(liveScopeBindings(editor, definitions, scope), bindingId)
}

/** Value and parameter names of a scope (see `enclosingBindingNames`). */
export function bindingNamesInScope(
  editor: NodeEditor<Schemes>,
  definitions: DefinitionRegistry,
  scope: string | null,
  excludeBindingId?: string,
): string[] {
  return enclosingBindingNames(liveScopeBindings(editor, definitions, scope), excludeBindingId)
}

/** Names a Value or definition parameter cannot take in `scope`: every other
 * binding including For iterators (see `reservedBindingNames`). */
export function reservedBindingNamesInScope(
  editor: NodeEditor<Schemes>,
  definitions: DefinitionRegistry,
  scope: string | null,
  excludeBindingId?: string,
): string[] {
  return reservedBindingNames(liveScopeBindings(editor, definitions, scope), excludeBindingId)
}

export function referencesToBinding(
  editor: NodeEditor<Schemes>,
  definitions: DefinitionRegistry,
  bindingId: string,
  scope: string | null,
): VariableReferenceNode[] {
  return editor.getNodes().filter((node): node is VariableReferenceNode =>
    node instanceof VariableReferenceNode
      && node.bindingId === bindingId
      && definitions.scopeOf(node.id) === scope,
  )
}

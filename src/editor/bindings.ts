import type { NodeEditor } from 'rete'

import type { DefinitionRegistry, ModuleParameterType } from './definitions'
import { BooleanNode, NumberNode, Vector3Node } from './nodes/value-nodes'
import { VariableReferenceNode, type VariableBindingResolution } from './nodes/variable-reference-node'
import type { Schemes } from './schemes'
import { ForHeaderNode } from './nodes/for-nodes'

export type ValueBindingNode = NumberNode | BooleanNode | Vector3Node

export function isValueBindingNode(node: Schemes['Node'] | undefined): node is ValueBindingNode {
  return node instanceof NumberNode || node instanceof BooleanNode || node instanceof Vector3Node
}

export function valueBindingType(node: ValueBindingNode): ModuleParameterType {
  return node instanceof NumberNode ? 'number' : node instanceof BooleanNode ? 'boolean' : 'vector3'
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
  for (const node of editor.getNodes()) {
    if (!(node instanceof ForHeaderNode) || node.bindingId !== bindingId) continue
    if ((definitions?.scopeOf(node.id) ?? null) !== scope) continue
    return { id: bindingId, name: node.getBindingName(), type: 'number' }
  }
  for (const node of editor.getNodes()) {
    if (!isValueBindingNode(node) || node.getBindingId() !== bindingId) continue
    if ((definitions?.scopeOf(node.id) ?? null) !== scope) continue
    return { id: bindingId, name: node.getBindingName(), type: valueBindingType(node) }
  }
  if (scope === null) return undefined
  const parameter = definitions?.get(scope)?.parameters?.find((item) => item.id === bindingId)
  return parameter ? { id: parameter.id, name: parameter.name, type: parameter.type } : undefined
}

export function bindingNamesInScope(
  editor: NodeEditor<Schemes>,
  definitions: DefinitionRegistry,
  scope: string | null,
  excludeBindingId?: string,
): string[] {
  const names = editor.getNodes()
    .filter(isValueBindingNode)
    .filter((node) => definitions.scopeOf(node.id) === scope && node.getBindingId() !== undefined && node.getBindingId() !== excludeBindingId)
    .map((node) => node.getBindingName())
  if (scope !== null) {
    names.push(...(definitions.get(scope)?.parameters ?? [])
      .filter((parameter) => parameter.id !== excludeBindingId)
      .map((parameter) => parameter.name))
  }
  return names
}

/** Names a Value or definition parameter cannot take in `scope`: every other
 * bound Value and parameter plus every For iterator of that scope. This is
 * the naming rule `.scadlet` validation enforces, so an accepted name can
 * always be saved. Iterators deliberately keep the narrower
 * `bindingNamesInScope` check because sibling loops may reuse a name. */
export function reservedBindingNamesInScope(
  editor: NodeEditor<Schemes>,
  definitions: DefinitionRegistry,
  scope: string | null,
  excludeBindingId?: string,
): string[] {
  const iterators = editor.getNodes()
    .filter((node): node is ForHeaderNode => node instanceof ForHeaderNode)
    .filter((node) => definitions.scopeOf(node.id) === scope && node.bindingId !== excludeBindingId)
    .map((node) => node.getBindingName())
  return [...bindingNamesInScope(editor, definitions, scope, excludeBindingId), ...iterators]
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

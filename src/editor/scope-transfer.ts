import type { NodeEditor } from 'rete'

import type { DefinitionRegistry } from './definitions'
import type { Schemes } from './schemes'
import { ModuleCallNode } from './nodes/module-call-node'
import { FUNCTION_GRAPH_ALLOWED_NODE_TYPES, identifyNodeType } from './node-catalog'
import { isValueBindingNode } from './bindings'
import { VariableReferenceNode } from './nodes/variable-reference-node'

export type ScopeTransferProblem = 'protected' | 'module-call' | 'connection' | 'function-incompatible'
  | 'settings-duplicate' | 'binding-conflict' | 'variable-reference'

/** Pure transaction preflight for a completed ordinary-node drag. It checks
 * the hypothetical final scopes for every touching connection as one set;
 * callers must not move nodes one by one. */
export function scopeTransferProblem(
  editor: NodeEditor<Schemes>,
  registry: DefinitionRegistry,
  nodeIds: readonly string[],
  targetScope: string | null,
): ScopeTransferProblem | null {
  const moved = new Set(nodeIds)
  const targetIsFunction = targetScope !== null && registry.get(targetScope)?.kind === 'function'
  for (const nodeId of moved) {
    const node = editor.getNode(nodeId)
    if (!node || registry.isProtectedNode(nodeId)) return 'protected'
    // Calls are valid in Main and Module scopes; Function scopes are pure
    // value-expression graphs and therefore accept resolved Function Calls
    // only. Recursive Calls remain subject to the same scope boundary.
    if (targetIsFunction && node instanceof ModuleCallNode) return 'module-call'
    // A Function's graph may only ever contain its own closed value-
    // expression vocabulary (AGENTS.md Milestone 8 Phase 7, section 6).
    if (targetIsFunction) {
      const type = identifyNodeType(node)
      if (!type || !FUNCTION_GRAPH_ALLOWED_NODE_TYPES.has(type)) return 'function-incompatible'
    }
  }
  const settingsInTarget = editor.getNodes().filter((node) => {
    if (identifyNodeType(node) !== 'scad-settings') return false
    const finalScope = moved.has(node.id) ? targetScope : registry.scopeOf(node.id)
    return finalScope === targetScope
  })
  if (settingsInTarget.length > 1) return 'settings-duplicate'
  const finalScope = (nodeId: string): string | null => moved.has(nodeId) ? targetScope : registry.scopeOf(nodeId)
  const namesByScope = new Map<string | null, Set<string>>()
  for (const definition of registry.list()) namesByScope.set(definition.id, new Set((definition.parameters ?? []).map((parameter) => parameter.name)))
  namesByScope.set(null, new Set())
  for (const node of editor.getNodes()) {
    if (!isValueBindingNode(node) || !node.getBindingId()) continue
    const scope = finalScope(node.id)
    const names = namesByScope.get(scope) ?? new Set<string>()
    if (names.has(node.getBindingName())) return 'binding-conflict'
    names.add(node.getBindingName())
    namesByScope.set(scope, names)
  }
  for (const node of editor.getNodes()) {
    if (!(node instanceof VariableReferenceNode)) continue
    const scope = finalScope(node.id)
    const valueDefinition = editor.getNodes().find((candidate) =>
      isValueBindingNode(candidate) && candidate.getBindingId() === node.bindingId && finalScope(candidate.id) === scope,
    )
    const parameterDefinition = scope === null ? undefined : registry.get(scope)?.parameters?.find((parameter) => parameter.id === node.bindingId)
    if (!valueDefinition && !parameterDefinition) return 'variable-reference'
  }
  return editor.getConnections().some((connection) =>
    (moved.has(connection.source) || moved.has(connection.target)) && finalScope(connection.source) !== finalScope(connection.target),
  ) ? 'connection' : null
}

import type { NodeEditor } from 'rete'

import type { DefinitionRegistry } from './definitions'
import type { Schemes } from './schemes'
import { ModuleCallNode } from './nodes/module-call-node'
import { FUNCTION_GRAPH_ALLOWED_NODE_TYPES, identifyNodeType } from './node-catalog'
import { liveBindingRecords } from './bindings'
import { scopeBindingProblem } from './scope-bindings'
import { ForHeaderNode, ForResultNode } from './nodes/for-nodes'

export type ScopeTransferProblem = 'protected' | 'module-call' | 'connection' | 'function-incompatible'
  | 'settings-duplicate' | 'binding-conflict' | 'variable-reference'
  | 'loop-pair'

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
  for (const nodeId of moved) {
    const node = editor.getNode(nodeId)
    if (!(node instanceof ForHeaderNode) && !(node instanceof ForResultNode)) continue
    const members = editor.getNodes().filter((candidate) =>
      (candidate instanceof ForHeaderNode || candidate instanceof ForResultNode) && candidate.pairId === node.pairId,
    )
    if (members.length !== 2 || members.some((member) => !moved.has(member.id))) return 'loop-pair'
  }
  const settingsInTarget = editor.getNodes().filter((node) => {
    if (identifyNodeType(node) !== 'scad-settings') return false
    const finalScope = moved.has(node.id) ? targetScope : registry.scopeOf(node.id)
    return finalScope === targetScope
  })
  if (settingsInTarget.length > 1) return 'settings-duplicate'
  const finalScope = (nodeId: string): string | null => moved.has(nodeId) ? targetScope : registry.scopeOf(nodeId)
  // Every scope's naming rules on the hypothetical final assignment. Name
  // conflicts anywhere take precedence over unresolved references.
  const problems = [null, ...registry.list().map((definition) => definition.id)].flatMap((scope) => {
    const parameters = scope === null ? [] : registry.get(scope)?.parameters ?? []
    const problem = scopeBindingProblem(liveBindingRecords(editor, finalScope, scope), parameters)
    return problem ? [problem] : []
  })
  if (problems.some((problem) => problem.code !== 'missing-reference')) return 'binding-conflict'
  if (problems.length > 0) return 'variable-reference'
  return editor.getConnections().some((connection) =>
    (moved.has(connection.source) || moved.has(connection.target)) && finalScope(connection.source) !== finalScope(connection.target),
  ) ? 'connection' : null
}

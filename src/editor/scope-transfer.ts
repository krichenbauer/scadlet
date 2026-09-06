import type { NodeEditor } from 'rete'

import type { DefinitionRegistry } from './definitions'
import type { Schemes } from './schemes'
import { ModuleCallNode } from './nodes/module-call-node'
import { FunctionCallNode } from './nodes/function-call-node'
import { FUNCTION_GRAPH_ALLOWED_NODE_TYPES, identifyNodeType } from './node-catalog'

export type ScopeTransferProblem = 'protected' | 'module-call' | 'connection' | 'function-incompatible'

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
    // Calls intentionally remain Main-only until nested Module/Function
    // semantics are designed, even though they are otherwise value-producing
    // nodes.
    if (targetScope !== null && (node instanceof ModuleCallNode || node instanceof FunctionCallNode)) return 'module-call'
    // A Function's graph may only ever contain its own closed value-
    // expression vocabulary (AGENTS.md Milestone 8 Phase 7, section 6).
    if (targetIsFunction) {
      const type = identifyNodeType(node)
      if (!type || !FUNCTION_GRAPH_ALLOWED_NODE_TYPES.has(type)) return 'function-incompatible'
    }
  }
  const finalScope = (nodeId: string): string | null => moved.has(nodeId) ? targetScope : registry.scopeOf(nodeId)
  return editor.getConnections().some((connection) =>
    (moved.has(connection.source) || moved.has(connection.target)) && finalScope(connection.source) !== finalScope(connection.target),
  ) ? 'connection' : null
}

import type { NodeEditor } from 'rete'

import type { DefinitionRegistry } from './definitions'
import type { Schemes } from './schemes'
import { ModuleCallNode } from './nodes/module-call-node'

export type ScopeTransferProblem = 'protected' | 'module-call' | 'connection'

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
  for (const nodeId of moved) {
    const node = editor.getNode(nodeId)
    if (!node || registry.isProtectedNode(nodeId)) return 'protected'
    // Calls intentionally remain Main-only until nested Module semantics are
    // designed, even though they are otherwise Geometry-producing nodes.
    if (targetScope !== null && node instanceof ModuleCallNode) return 'module-call'
  }
  const finalScope = (nodeId: string): string | null => moved.has(nodeId) ? targetScope : registry.scopeOf(nodeId)
  return editor.getConnections().some((connection) =>
    (moved.has(connection.source) || moved.has(connection.target)) && finalScope(connection.source) !== finalScope(connection.target),
  ) ? 'connection' : null
}

import type { NodeEditor } from 'rete'

import type { Schemes } from './schemes'

export type DefinitionKind = 'module'

/** Runtime definition metadata. Node content remains authoritative in Rete;
 * this small registry owns stable definition identity and graph membership. */
export interface ModuleDefinition {
  id: string
  kind: DefinitionKind
  name: string
  inputsNodeId: string
  outputNodeId: string
}

export type ModuleNameProblem = 'empty' | 'identifier' | 'duplicate'

const MODULE_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/

export function moduleNameProblem(name: string, existingNames: Iterable<string>): ModuleNameProblem | null {
  if (!name.trim()) return 'empty'
  if (!MODULE_IDENTIFIER.test(name)) return 'identifier'
  return new Set(existingNames).has(name) ? 'duplicate' : null
}

export class DefinitionRegistry {
  private readonly definitions = new Map<string, ModuleDefinition>()
  private readonly scopes = new Map<string, string>()
  private readonly listeners = new Set<() => void>()

  list(): readonly ModuleDefinition[] { return [...this.definitions.values()] }
  get(id: string): ModuleDefinition | undefined { return this.definitions.get(id) }
  scopeOf(nodeId: string): string | null { return this.scopes.get(nodeId) ?? null }
  isProtectedNode(nodeId: string): boolean { return this.scopes.has(nodeId) }

  add(definition: ModuleDefinition): void {
    this.definitions.set(definition.id, definition)
    this.scopes.set(definition.inputsNodeId, definition.id)
    this.scopes.set(definition.outputNodeId, definition.id)
    this.emit()
  }

  clear(): void {
    if (this.definitions.size === 0) return
    this.definitions.clear()
    this.scopes.clear()
    this.emit()
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private emit(): void {
    for (const listener of this.listeners) listener()
  }
}

const registries = new WeakMap<NodeEditor<Schemes>, DefinitionRegistry>()

export function bindDefinitionRegistry(editor: NodeEditor<Schemes>, registry: DefinitionRegistry): void {
  registries.set(editor, registry)
}

/** Main has the implicit scope `null`; each definition has its stable ID as
 * a scope. Regular wiring may only ever stay inside one of those graphs. */
export function shareDefinitionScope(editor: NodeEditor<Schemes>, firstNodeId: string, secondNodeId: string): boolean {
  const registry = registries.get(editor)
  if (!registry) return true
  return registry.scopeOf(firstNodeId) === registry.scopeOf(secondNodeId)
}

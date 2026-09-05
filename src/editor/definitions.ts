import type { NodeEditor } from 'rete'

import type { Schemes } from './schemes'

export type DefinitionKind = 'module'
export type ModuleParameterType = 'number' | 'boolean' | 'vector3'
export type ModuleParameterDefault = number | boolean | [number, number, number]

/** Ordered semantic signature entry. Its id, rather than the mutable name,
 * is the durable identity of the corresponding Inputs/Call port. */
export interface ModuleParameter {
  id: string
  name: string
  type: ModuleParameterType
  default: ModuleParameterDefault
}

/** Runtime definition metadata. Node content remains authoritative in Rete;
 * this small registry owns stable definition identity and graph membership. */
export interface ModuleDefinition {
  id: string
  kind: DefinitionKind
  name: string
  inputsNodeId: string
  outputNodeId: string
  /** Always present for newly-created/restored definitions. Optional only at
   * this TypeScript boundary so older test/embedder fixtures remain valid. */
  parameters?: readonly ModuleParameter[]
}

export type ModuleNameProblem = 'empty' | 'identifier' | 'duplicate'
export type ModuleParameterNameProblem = 'empty' | 'identifier' | 'duplicate'

const MODULE_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/

export function moduleNameProblem(name: string, existingNames: Iterable<string>): ModuleNameProblem | null {
  if (!name.trim()) return 'empty'
  if (!MODULE_IDENTIFIER.test(name)) return 'identifier'
  return new Set(existingNames).has(name) ? 'duplicate' : null
}

export function moduleParameterNameProblem(name: string, existingNames: Iterable<string>): ModuleParameterNameProblem | null {
  if (!name.trim()) return 'empty'
  if (!MODULE_IDENTIFIER.test(name)) return 'identifier'
  return new Set(existingNames).has(name) ? 'duplicate' : null
}

export function moduleParameterPortId(id: string): string { return `parameter:${id}` }

export function defaultForModuleParameterType(type: ModuleParameterType): ModuleParameterDefault {
  if (type === 'number') return 0
  if (type === 'boolean') return false
  return [0, 0, 0]
}

export function moduleParameterDefaultIsValid(type: ModuleParameterType, value: unknown): value is ModuleParameterDefault {
  if (type === 'number') return typeof value === 'number' && Number.isFinite(value)
  if (type === 'boolean') return typeof value === 'boolean'
  return Array.isArray(value) && value.length === 3 && value.every((item) => typeof item === 'number' && Number.isFinite(item))
}

export class DefinitionRegistry {
  private readonly definitions = new Map<string, ModuleDefinition>()
  private readonly scopes = new Map<string, string>()
  private readonly protectedNodeIds = new Set<string>()
  private readonly listeners = new Set<() => void>()

  list(): readonly ModuleDefinition[] { return [...this.definitions.values()] }
  get(id: string): ModuleDefinition | undefined { return this.definitions.get(id) }
  /** Semantic membership only. Never derive this from a frame's geometry. */
  nodeIds(id: string): readonly string[] {
    return [...this.scopes.entries()]
      .filter(([, scope]) => scope === id)
      .map(([nodeId]) => nodeId)
  }
  scopeOf(nodeId: string): string | null { return this.scopes.get(nodeId) ?? null }
  /** Only permanent interface nodes are protected. Ordinary body nodes are
   * scoped too, but remain normal removable graph nodes. */
  isProtectedNode(nodeId: string): boolean { return this.protectedNodeIds.has(nodeId) }

  /** Assigns explicit, persistent semantic ownership. A frame's geometry is
   * never consulted after this creation/restore-time assignment. */
  assignNode(definitionId: string, nodeId: string): void {
    this.setNodeScopes([nodeId], definitionId)
  }

  /** Atomically changes a transferable set's ownership. `null` is Main's
   * implicit scope. Callers preflight connections before invoking this, so
   * the registry never represents a transient cross-scope graph. */
  setNodeScopes(nodeIds: readonly string[], scope: string | null): void {
    if (scope !== null && !this.definitions.has(scope)) throw new Error(`Unknown Module definition "${scope}".`)
    if (nodeIds.every((nodeId) => this.scopeOf(nodeId) === scope)) return
    if (nodeIds.some((nodeId) => this.protectedNodeIds.has(nodeId))) throw new Error('Module interface nodes cannot change scope.')
    for (const nodeId of nodeIds) {
      if (scope === null) this.scopes.delete(nodeId)
      else this.scopes.set(nodeId, scope)
    }
    this.emit()
  }

  /** Removes a deleted ordinary node from scope membership. Interfaces are
   * never deletable through the editor and remain definition infrastructure. */
  forgetNode(nodeId: string): void {
    if (!this.scopes.has(nodeId) || this.protectedNodeIds.has(nodeId)) return
    this.scopes.delete(nodeId)
    this.emit()
  }

  add(definition: ModuleDefinition): void {
    validateModuleParameters(definition.parameters ?? [])
    this.definitions.set(definition.id, definition)
    this.scopes.set(definition.inputsNodeId, definition.id)
    this.scopes.set(definition.outputNodeId, definition.id)
    this.protectedNodeIds.add(definition.inputsNodeId)
    this.protectedNodeIds.add(definition.outputNodeId)
    this.emit()
  }

  /** Signature additions are deliberately narrow in Phase 3. Keeping this
   * registry operation atomic gives Phase 4 a single place to add the
   * destructive rename/reorder/delete/type-change preflight later. */
  addParameter(definitionId: string, parameter: ModuleParameter): void {
    const definition = this.definitions.get(definitionId)
    if (!definition) throw new Error(`Unknown Module definition "${definitionId}".`)
    const parameters = definition.parameters ?? []
    validateModuleParameters([...parameters, parameter])
    this.definitions.set(definitionId, { ...definition, parameters: [...parameters, parameter] })
    this.emit()
  }

  clear(): void {
    if (this.definitions.size === 0) return
    this.definitions.clear()
    this.scopes.clear()
    this.protectedNodeIds.clear()
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

export function validateModuleParameters(parameters: readonly ModuleParameter[]): void {
  const ids = new Set<string>()
  const names = new Set<string>()
  for (const parameter of parameters) {
    if (!parameter.id) throw new Error('Module parameter id must be non-empty.')
    if (ids.has(parameter.id)) throw new Error(`Duplicate Module parameter id "${parameter.id}".`)
    ids.add(parameter.id)
    if (moduleParameterNameProblem(parameter.name, names) !== null) throw new Error(`Invalid or duplicate Module parameter name "${parameter.name}".`)
    names.add(parameter.name)
    if (!['number', 'boolean', 'vector3'].includes(parameter.type)) throw new Error(`Unsupported Module parameter type "${String(parameter.type)}".`)
    if (!moduleParameterDefaultIsValid(parameter.type, parameter.default)) throw new Error(`Invalid default for Module parameter "${parameter.name}".`)
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

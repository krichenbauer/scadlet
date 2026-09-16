import type { NodeEditor } from 'rete'

import type { Schemes } from './schemes'

export type DefinitionKind = 'module' | 'function'
export type ModuleParameterType = 'number' | 'boolean' | 'vector3'
export type ModuleParameterDefault = number | boolean | [number, number, number]
/** A Function's result type is drawn from the same closed value vocabulary
 * as a parameter's type. Kept as a distinct alias for readability at
 * Function-specific call sites, not a different underlying type. */
export type FunctionResultType = ModuleParameterType

/** Ordered semantic signature entry. Its id, rather than the mutable name,
 * is the durable identity of the corresponding Inputs/Call port. */
export interface ModuleParameter {
  id: string
  name: string
  type: ModuleParameterType
  default: ModuleParameterDefault
}

/** Ordered Geometry child signature entry. It deliberately has no OpenSCAD
 * type/default/fallback: its stable id owns the corresponding child index. */
export interface ModuleGeometryInput {
  id: string
  name: string
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
  /** Ordered, named child-block inputs. Kept separate from value parameters.
   * Only ever populated for `kind: 'module'`; a Function has no Geometry
   * children or `children()` semantics. */
  geometryInputs?: readonly ModuleGeometryInput[]
  /** Only meaningful for `kind: 'function'`. `undefined` means the Function
   * is a valid, saveable draft whose result expression hasn't been
   * connected yet - it cannot be emitted as OpenSCAD or called until this
   * is set (see `DefinitionRegistry.setResultType`). */
  resultType?: FunctionResultType
}

export type ModuleNameProblem = 'empty' | 'identifier' | 'duplicate'
export type ModuleParameterNameProblem = 'empty' | 'identifier' | 'duplicate'

export const OPENSCAD_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/

export function isOpenSCADIdentifier(name: string): boolean {
  return OPENSCAD_IDENTIFIER.test(name)
}

export function moduleNameProblem(name: string, existingNames: Iterable<string>): ModuleNameProblem | null {
  if (!name.trim()) return 'empty'
  if (!isOpenSCADIdentifier(name)) return 'identifier'
  return new Set(existingNames).has(name) ? 'duplicate' : null
}

export function moduleParameterNameProblem(name: string, existingNames: Iterable<string>): ModuleParameterNameProblem | null {
  if (!name.trim()) return 'empty'
  if (!isOpenSCADIdentifier(name)) return 'identifier'
  return new Set(existingNames).has(name) ? 'duplicate' : null
}

export function moduleParameterPortId(id: string): string { return `parameter:${id}` }
/** Stable port identity for one ordered Module child input. */
export function moduleGeometryInputPortId(id: string): string { return `geometry:${id}` }
/** Historical v3 connection key used only by the v3→v4 migration. */
export const MODULE_CHILD_PORT_ID = 'children'

export function defaultModuleGeometryInput(definitionId: string): ModuleGeometryInput {
  return { id: `${definitionId}:geometry-1`, name: 'Geometry 1' }
}

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
    validateModuleGeometryInputs(definition.geometryInputs ?? [])
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

  /** Replaces one already-validated signature atomically. Stable IDs are
   * deliberately retained by callers for every edit except deletion. */
  setParameters(definitionId: string, parameters: readonly ModuleParameter[]): void {
    const definition = this.definitions.get(definitionId)
    if (!definition) throw new Error(`Unknown Module definition "${definitionId}".`)
    validateModuleParameters(parameters)
    this.definitions.set(definitionId, { ...definition, parameters: [...parameters] })
    this.emit()
  }

  setGeometryInputs(definitionId: string, geometryInputs: readonly ModuleGeometryInput[]): void {
    const definition = this.definitions.get(definitionId)
    if (!definition) throw new Error(`Unknown Module definition "${definitionId}".`)
    validateModuleGeometryInputs(geometryInputs)
    this.definitions.set(definitionId, { ...definition, geometryInputs: [...geometryInputs] })
    this.emit()
  }

  /** Resolves, changes, or clears (`undefined`) a Function's inferred result
   * type. Callers preflight every affected Call connection before invoking
   * this - the registry itself only records the already-decided outcome. */
  setResultType(definitionId: string, resultType: FunctionResultType | undefined): void {
    const definition = this.definitions.get(definitionId)
    if (!definition) throw new Error(`Unknown Function definition "${definitionId}".`)
    if (definition.kind !== 'function') throw new Error(`Definition "${definitionId}" is not a Function.`)
    this.definitions.set(definitionId, { ...definition, resultType })
    this.emit()
  }

  rename(definitionId: string, name: string): boolean {
    const definition = this.definitions.get(definitionId)
    if (!definition) throw new Error(`Unknown Module definition "${definitionId}".`)
    if (definition.name === name) return false
    this.definitions.set(definitionId, { ...definition, name })
    this.emit()
    return true
  }

  /** Removes the registry-owned scope after the editor has removed every
   * member through Rete's normal node/connection lifecycle. */
  remove(definitionId: string): void {
    const definition = this.definitions.get(definitionId)
    if (!definition) throw new Error(`Unknown Module definition "${definitionId}".`)
    this.definitions.delete(definitionId)
    for (const [nodeId, scope] of this.scopes) if (scope === definitionId) this.scopes.delete(nodeId)
    this.protectedNodeIds.delete(definition.inputsNodeId)
    this.protectedNodeIds.delete(definition.outputNodeId)
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

export function validateModuleGeometryInputs(inputs: readonly ModuleGeometryInput[]): void {
  const ids = new Set<string>()
  for (const input of inputs) {
    if (!input.id) throw new Error('Module Geometry input id must be non-empty.')
    if (ids.has(input.id)) throw new Error(`Duplicate Module Geometry input id "${input.id}".`)
    ids.add(input.id)
    if (!input.name.trim()) throw new Error('Module Geometry input name must be non-empty.')
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

/** Resolves a node's semantic graph scope for structural analyses. Hosts
 * without definition support have only Main, represented by `null`. */
export function definitionScopeOf(editor: NodeEditor<Schemes>, nodeId: string): string | null {
  return registries.get(editor)?.scopeOf(nodeId) ?? null
}

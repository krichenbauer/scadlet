import { findCatalogEntry } from '../editor/node-catalog'
import { moduleNameProblem } from '../editor/definitions'
import {
  SCADLET_FORMAT,
  SCADLET_VERSION,
  type ScadletConnectionDTO,
  type ScadletEditorState,
  type ScadletGraph,
  type ScadletNodeDTO,
  type ScadletProjectMetadata,
  type ScadletModuleDefinition,
  type ScadletProjectV1,
  type ScadletViewerCamera,
  type ScadletViewerState,
  type ScadletViewport,
} from './project'

/** Thrown for any malformed/invalid `.scadlet` project input, with a message meant to be shown directly to the user (AGENTS.md: no raw stack traces). */
export class ScadletProjectError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ScadletProjectError'
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function requireFiniteNumber(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new ScadletProjectError(`Invalid ${label}: expected a finite number`)
  }
  return value
}

/**
 * Parses and fully validates a `.scadlet` file's raw text into a
 * `ScadletProjectV1`, throwing a `ScadletProjectError` with a specific,
 * user-facing message for the first problem found. Performs no mutation
 * of any kind - callers (`restore.ts`, `file-service.ts`) only replace
 * the current project after this succeeds completely (AGENTS.md: atomic
 * project loading).
 */
export function parseScadletProjectText(text: string): ScadletProjectV1 {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new ScadletProjectError('This file is not valid JSON.')
  }
  return parseScadletProject(raw)
}

/** Same as `parseScadletProjectText`, but for an already-parsed value (e.g. from a test fixture). */
export function parseScadletProject(raw: unknown): ScadletProjectV1 {
  if (!isPlainObject(raw)) {
    throw new ScadletProjectError('A SCADlet project file must be a JSON object.')
  }
  if (raw.format === undefined) {
    throw new ScadletProjectError('Not a SCADlet project file: missing "format".')
  }
  if (raw.format !== SCADLET_FORMAT) {
    throw new ScadletProjectError(`Not a SCADlet project file: unexpected "format" value "${String(raw.format)}".`)
  }
  if (typeof raw.version !== 'number') {
    throw new ScadletProjectError('SCADlet project is missing a numeric "version".')
  }
  return migrateScadletProject(raw.version, raw)
}

/**
 * The version → validator migration boundary. Older raw objects are
 * converted through each known format shape before one current validator
 * runs, so call sites never need to understand historical versions.
 */
function migrateScadletProject(version: number, raw: Record<string, unknown>): ScadletProjectV1 {
  if (version === SCADLET_VERSION) return validateV1(raw)
  if (version === 2) return validateV1(migrateV2ToV3(raw))
  if (version === 1) return validateV1(migrateV2ToV3(migrateV1ToV2(raw)))
  throw new ScadletProjectError(`Unsupported SCADlet project version: ${version}`)
}

/** Converts the former fixed-parameter/fixed-two-child representation into
 * v2's semantic signatures before the normal v2 validator runs. */
function migrateV1ToV2(raw: Record<string, unknown>): Record<string, unknown> {
  const graph = isPlainObject(raw.graph) ? raw.graph : {}
  const rawNodes = Array.isArray(graph.nodes) ? graph.nodes : graph.nodes
  const portMaps = new Map<string, Record<string, string>>()
  const nodes = Array.isArray(rawNodes) ? rawNodes.map((rawNode) => {
    if (!isPlainObject(rawNode)) return rawNode
    const node = { ...rawNode }
    if (node.type === 'cube' && isPlainObject(node.parameters)) {
      const p = node.parameters
      if (typeof p.sizeX === 'number' && typeof p.sizeY === 'number' && typeof p.sizeZ === 'number') node.parameters = { size: p.sizeX === p.sizeY && p.sizeY === p.sizeZ ? p.sizeX : { x: p.sizeX, y: p.sizeY, z: p.sizeZ }, ...(p.center === true ? { center: true } : {}) }
    }
    if ((node.type === 'union' || node.type === 'intersection') && typeof node.id === 'string') {
      const a = 'v1-a'; const b = 'v1-b'; node.parameters = { children: [{ id: a }, { id: b }, { id: 'v1-next' }] }
      portMaps.set(node.id, { a: `child:${a}`, b: `child:${b}` })
    }
    return node
  }) : rawNodes
  const rawConnections = Array.isArray(graph.connections) ? graph.connections : graph.connections
  const connections = Array.isArray(rawConnections) ? rawConnections.map((rawConnection) => {
    if (!isPlainObject(rawConnection)) return rawConnection
    const mapped = typeof rawConnection.target === 'string' ? portMaps.get(rawConnection.target) : undefined
    return mapped && typeof rawConnection.targetInput === 'string' && mapped[rawConnection.targetInput]
      ? { ...rawConnection, targetInput: mapped[rawConnection.targetInput] }
      : rawConnection
  }) : rawConnections
  return { ...raw, version: 2, graph: { ...graph, nodes, connections } }
}

/** v3 adds project-level definitions without changing the Main graph. */
function migrateV2ToV3(raw: Record<string, unknown>): Record<string, unknown> {
  return { ...raw, version: SCADLET_VERSION, definitions: [] }
}

function validateV1(raw: Record<string, unknown>): ScadletProjectV1 {
  const metadata = validateMetadata(raw.metadata)
  const graph = validateGraph(raw.graph, 'main')
  const definitions = validateDefinitions(raw.definitions)
  const mainNodeIds = new Set(graph.nodes.map((node) => node.id))
  for (const definition of definitions) {
    for (const node of definition.graph.nodes) {
      if (mainNodeIds.has(node.id)) {
        throw new ScadletProjectError(`Node id "${node.id}" is shared by Main and a Module definition.`)
      }
    }
  }
  validateModuleCalls(graph, definitions)
  const editorState = validateEditorState(raw.editor)
  const viewer = validateViewerState(raw.viewer)
  return { format: SCADLET_FORMAT, version: SCADLET_VERSION, metadata, graph, definitions, editor: editorState, viewer }
}

function validateMetadata(raw: unknown): ScadletProjectMetadata {
  if (!isPlainObject(raw)) throw new ScadletProjectError('Project "metadata" must be an object.')
  if (typeof raw.name !== 'string' || raw.name.trim().length === 0) {
    throw new ScadletProjectError('Project metadata is missing a project "name".')
  }
  const metadata: ScadletProjectMetadata = { name: raw.name }
  if (raw.createdAt !== undefined) {
    if (typeof raw.createdAt !== 'string') throw new ScadletProjectError('Invalid metadata "createdAt": expected a string.')
    metadata.createdAt = raw.createdAt
  }
  if (raw.updatedAt !== undefined) {
    if (typeof raw.updatedAt !== 'string') throw new ScadletProjectError('Invalid metadata "updatedAt": expected a string.')
    metadata.updatedAt = raw.updatedAt
  }
  return metadata
}

function validatePosition(raw: unknown, nodeId: string): { x: number; y: number } {
  if (!isPlainObject(raw)) throw new ScadletProjectError(`Node "${nodeId}" has an invalid "position".`)
  return {
    x: requireFiniteNumber(raw.x, `node "${nodeId}" position.x`),
    y: requireFiniteNumber(raw.y, `node "${nodeId}" position.y`),
  }
}

function validateNode(raw: unknown, index: number, seenIds: Set<string>, graphKind: 'main' | 'definition'): ScadletNodeDTO {
  if (!isPlainObject(raw)) throw new ScadletProjectError(`Node at index ${index} must be an object.`)

  if (typeof raw.id !== 'string' || raw.id.length === 0) {
    throw new ScadletProjectError(`Node at index ${index} is missing a valid "id".`)
  }
  if (seenIds.has(raw.id)) throw new ScadletProjectError(`Duplicate node id: "${raw.id}"`)
  seenIds.add(raw.id)

  if (typeof raw.type !== 'string') throw new ScadletProjectError(`Node "${raw.id}" is missing a "type".`)
  const entry = findCatalogEntry(raw.type)
  if (!entry) throw new ScadletProjectError(`Unknown node type: "${raw.type}"`)
  if (graphKind === 'main' && entry.palette === false && entry.type !== 'module-call') {
    throw new ScadletProjectError(`Interface node "${raw.id}" belongs inside a Module definition, not Main.`)
  }
  if (graphKind === 'definition' && entry.type === 'module-call') {
    throw new ScadletProjectError(`Module Call node "${raw.id}" belongs in Main, not inside a Module definition.`)
  }

  const position = validatePosition(raw.position, raw.id)

  let parameters: Record<string, unknown>
  try {
    parameters = entry.validateParams(raw.parameters ?? {})
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new ScadletProjectError(`Invalid parameters for node "${raw.id}" (${entry.type}): ${message}`)
  }

  const node: ScadletNodeDTO = { id: raw.id, type: entry.type, position, parameters }
  if (raw.pinned !== undefined) {
    if (typeof raw.pinned !== 'boolean') throw new ScadletProjectError(`Node "${raw.id}" has an invalid "pinned" value.`)
    node.pinned = raw.pinned
  }
  return node
}

function validateConnection(
  raw: unknown,
  index: number,
  seenIds: Set<string>,
  nodesById: Map<string, ScadletNodeDTO>,
): ScadletConnectionDTO {
  if (!isPlainObject(raw)) throw new ScadletProjectError(`Connection at index ${index} must be an object.`)

  if (typeof raw.id !== 'string' || raw.id.length === 0) {
    throw new ScadletProjectError(`Connection at index ${index} is missing a valid "id".`)
  }
  if (seenIds.has(raw.id)) throw new ScadletProjectError(`Duplicate connection id: "${raw.id}"`)
  seenIds.add(raw.id)

  const { source, sourceOutput, target, targetInput } = raw
  if (typeof source !== 'string' || typeof target !== 'string') {
    throw new ScadletProjectError(`Connection "${raw.id}" is missing a "source"/"target" node id.`)
  }
  if (typeof sourceOutput !== 'string' || typeof targetInput !== 'string') {
    throw new ScadletProjectError(`Connection "${raw.id}" is missing a "sourceOutput"/"targetInput" port id.`)
  }

  const sourceNode = nodesById.get(source)
  if (!sourceNode) throw new ScadletProjectError(`Connection "${raw.id}" references missing source node "${source}"`)
  const targetNode = nodesById.get(target)
  if (!targetNode) throw new ScadletProjectError(`Connection "${raw.id}" references missing target node "${target}"`)

  const sourceEntry = findCatalogEntry(sourceNode.type)!
  if (!sourceEntry.outputs.includes(sourceOutput)) {
    throw new ScadletProjectError(`Connection "${raw.id}" references unknown source port "${sourceOutput}" on node "${source}"`)
  }
  const targetEntry = findCatalogEntry(targetNode.type)!
  if (!targetEntry.inputs.includes(targetInput) && !targetEntry.isInputPort?.(targetInput, targetNode.parameters)) {
    throw new ScadletProjectError(`Connection "${raw.id}" references unknown target port "${targetInput}" on node "${target}"`)
  }

  const sourceType = sourceEntry.outputSocketType(sourceOutput)
  const targetType = targetEntry.inputSocketType(targetInput, targetNode.parameters)
  if (!sourceType || !targetType || sourceType !== targetType) {
    throw new ScadletProjectError(
      `Connection "${raw.id}" has incompatible socket types: ${sourceType ?? 'unknown'} output cannot connect to ${targetType ?? 'unknown'} input.`,
    )
  }

  return { id: raw.id, source, sourceOutput, target, targetInput }
}

function validateGraph(raw: unknown, graphKind: 'main' | 'definition'): ScadletGraph {
  if (!isPlainObject(raw)) throw new ScadletProjectError('Project "graph" must be an object.')

  if (!Array.isArray(raw.nodes)) throw new ScadletProjectError('Project "graph.nodes" must be an array.')
  const seenNodeIds = new Set<string>()
  const nodes = raw.nodes.map((node, index) => validateNode(node, index, seenNodeIds, graphKind))
  const nodesById = new Map(nodes.map((node) => [node.id, node]))

  if (!Array.isArray(raw.connections)) throw new ScadletProjectError('Project "graph.connections" must be an array.')
  const seenConnectionIds = new Set<string>()
  const connections = raw.connections.map((connection, index) =>
    validateConnection(connection, index, seenConnectionIds, nodesById),
  )

  return { nodes, connections }
}

function validateDefinitions(raw: unknown): ScadletModuleDefinition[] {
  if (!Array.isArray(raw)) throw new ScadletProjectError('Project "definitions" must be an array.')
  const seenDefinitionIds = new Set<string>()
  const seenNames = new Set<string>()
  const seenNodeIds = new Set<string>()
  const definitions: ScadletModuleDefinition[] = []
  for (const item of raw) {
    if (!isPlainObject(item)) throw new ScadletProjectError('Each definition must be an object.')
    if (typeof item.id !== 'string' || !item.id) throw new ScadletProjectError('A definition is missing a valid "id".')
    if (seenDefinitionIds.has(item.id)) throw new ScadletProjectError(`Duplicate definition id: "${item.id}"`)
    seenDefinitionIds.add(item.id)
    if (item.kind !== 'module') throw new ScadletProjectError(`Definition "${item.id}" has an invalid "kind".`)
    if (typeof item.name !== 'string' || moduleNameProblem(item.name, seenNames) !== null) {
      throw new ScadletProjectError(`Definition "${item.id}" has an invalid or duplicate Module name.`)
    }
    seenNames.add(item.name)
    const interfaceRoles = item.interface
    if (!isPlainObject(interfaceRoles) || typeof interfaceRoles.inputs !== 'string' || typeof interfaceRoles.output !== 'string') {
      throw new ScadletProjectError(`Module definition "${item.id}" has invalid interface roles.`)
    }
    const graph = validateGraph(item.graph, 'definition')
    for (const node of graph.nodes) {
      if (seenNodeIds.has(node.id)) throw new ScadletProjectError(`Duplicate node id across definition graphs: "${node.id}"`)
      seenNodeIds.add(node.id)
    }
    const allInputs = graph.nodes.filter((node) => node.type === 'module-inputs')
    const allOutputs = graph.nodes.filter((node) => node.type === 'module-output')
    const inputs = allInputs.filter((node) => node.id === interfaceRoles.inputs)
    const outputs = allOutputs.filter((node) => node.id === interfaceRoles.output)
    if (allInputs.length !== 1 || inputs.length !== 1) throw new ScadletProjectError(`Module definition "${item.id}" must contain exactly one Inputs interface node.`)
    if (allOutputs.length !== 1 || outputs.length !== 1) throw new ScadletProjectError(`Module definition "${item.id}" must contain exactly one Output interface node.`)
    const output = outputs[0]
    if (output.type !== 'module-output') throw new ScadletProjectError(`Module definition "${item.id}" has an invalid Output interface node.`)
    definitions.push({
      id: item.id,
      kind: 'module',
      name: item.name,
      interface: { inputs: interfaceRoles.inputs, output: interfaceRoles.output },
      graph,
    })
  }
  return definitions
}

/** Calls are normal Main Geometry nodes, but their durable target is a
 * project definition ID rather than a copied display name. Resolve this only
 * after all definitions have been fully validated. */
function validateModuleCalls(graph: ScadletGraph, definitions: readonly ScadletModuleDefinition[]): void {
  const definitionIds = new Set(definitions.filter((definition) => definition.kind === 'module').map((definition) => definition.id))
  for (const node of graph.nodes) {
    if (node.type !== 'module-call') continue
    const definitionId = node.parameters.definitionId
    if (typeof definitionId !== 'string' || !definitionIds.has(definitionId)) {
      throw new ScadletProjectError(`Module Call node "${node.id}" references unknown Module definition "${String(definitionId)}".`)
    }
  }
}

function validateEditorState(raw: unknown): ScadletEditorState {
  if (!isPlainObject(raw)) throw new ScadletProjectError('Project "editor" must be an object.')
  return { viewport: validateViewport(raw.viewport) }
}

function validateViewport(raw: unknown): ScadletViewport {
  if (!isPlainObject(raw)) throw new ScadletProjectError('Invalid "editor.viewport": expected an object.')
  return {
    x: requireFiniteNumber(raw.x, 'editor.viewport.x'),
    y: requireFiniteNumber(raw.y, 'editor.viewport.y'),
    zoom: requireFiniteNumber(raw.zoom, 'editor.viewport.zoom'),
  }
}

function validateViewerState(raw: unknown): ScadletViewerState {
  if (!isPlainObject(raw)) throw new ScadletProjectError('Project "viewer" must be an object.')
  return { camera: validateCamera(raw.camera) }
}

function validateVector3Tuple(raw: unknown, label: string): [number, number, number] {
  if (!Array.isArray(raw) || raw.length !== 3) {
    throw new ScadletProjectError(`Invalid ${label}: expected an array of 3 numbers.`)
  }
  return [
    requireFiniteNumber(raw[0], `${label}[0]`),
    requireFiniteNumber(raw[1], `${label}[1]`),
    requireFiniteNumber(raw[2], `${label}[2]`),
  ]
}

function validateCamera(raw: unknown): ScadletViewerCamera {
  if (!isPlainObject(raw)) throw new ScadletProjectError('Invalid "viewer.camera": expected an object.')
  return {
    position: validateVector3Tuple(raw.position, 'viewer.camera.position'),
    target: validateVector3Tuple(raw.target, 'viewer.camera.target'),
  }
}

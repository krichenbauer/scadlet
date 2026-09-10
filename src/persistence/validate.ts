import { findCatalogEntry, FUNCTION_GRAPH_ALLOWED_NODE_TYPES } from '../editor/node-catalog'
import { defaultModuleGeometryInput, moduleGeometryInputPortId, moduleNameProblem, moduleParameterDefaultIsValid, moduleParameterPortId, moduleParameterNameProblem, type FunctionResultType, type ModuleGeometryInput, type ModuleParameter, type ModuleParameterType } from '../editor/definitions'
import { analyzeFunctionDependencies } from '../editor/function-dependencies'
import {
  SCADLET_FORMAT,
  SCADLET_VERSION,
  type ScadletConnectionDTO,
  type ScadletDefinition,
  type ScadletEditorState,
  type ScadletGraph,
  type ScadletNodeDTO,
  type ScadletProjectMetadata,
  type ScadletFunctionDefinition,
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
  if (version === 5) return validateV1(migrateV5ToV6(raw))
  if (version === 4) return validateV1(migrateV5ToV6(migrateV4ToV5(raw)))
  if (version === 3) return validateV1(migrateV5ToV6(migrateV4ToV5(migrateV3ToV4(raw))))
  if (version === 2) return validateV1(migrateV5ToV6(migrateV4ToV5(migrateV3ToV4(migrateV2ToV3(raw)))))
  if (version === 1) return validateV1(migrateV5ToV6(migrateV4ToV5(migrateV3ToV4(migrateV2ToV3(migrateV1ToV2(raw))))))
  throw new ScadletProjectError(`Unsupported SCADlet project version: ${version}`)
}

/** v5 adds Function definitions alongside Modules. Every existing v4 record
 * is already a valid `kind: 'module'` definition; only the version number
 * and the (already-empty-by-default) Function registry are new. */
function migrateV4ToV5(raw: Record<string, unknown>): Record<string, unknown> {
  return { ...raw, version: 5 }
}

/** v6 consolidates the four legacy binary arithmetic node types. Their
 * `a`, `b`, and `value` endpoint ids already match the canonical Arithmetic
 * node, so graph identity, layout, scopes, and every valid wire survive
 * without endpoint rewriting. */
function migrateV5ToV6(raw: Record<string, unknown>): Record<string, unknown> {
  const operations: Record<string, string> = {
    add: 'addition', subtract: 'subtraction', multiply: 'multiplication', divide: 'division',
  }
  const migrateGraph = (value: unknown): unknown => {
    if (!isPlainObject(value) || !Array.isArray(value.nodes)) return value
    return {
      ...value,
      nodes: value.nodes.map((item) => {
        if (!isPlainObject(item) || typeof item.type !== 'string' || !operations[item.type]) return item
        const parameters = item.parameters
        return {
          ...item,
          type: 'arithmetic',
          parameters: isPlainObject(parameters) ? { ...parameters, operation: operations[item.type] } : parameters,
        }
      }),
    }
  }
  const definitions = Array.isArray(raw.definitions)
    ? raw.definitions.map((item) => isPlainObject(item) ? { ...item, graph: migrateGraph(item.graph) } : item)
    : raw.definitions
  return { ...raw, version: SCADLET_VERSION, graph: migrateGraph(raw.graph), definitions }
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
  return { ...raw, version: 3, definitions: [] }
}

/** v4 replaces the old single structural `children` port with an ordered
 * signature. The deterministic first id preserves every v3 child wire. */
function migrateV3ToV4(raw: Record<string, unknown>): Record<string, unknown> {
  const definitions = Array.isArray(raw.definitions) ? raw.definitions.map((item) => {
    if (!isPlainObject(item) || typeof item.id !== 'string') return item
    const geometryInput = defaultModuleGeometryInput(item.id)
    const graph = isPlainObject(item.graph) ? item.graph : {}
    const connections = Array.isArray(graph.connections) ? graph.connections.map((connection) => {
      if (!isPlainObject(connection)) return connection
      return connection.sourceOutput === 'children'
        ? { ...connection, sourceOutput: moduleGeometryInputPortId(geometryInput.id) }
        : connection
    }) : graph.connections
    return { ...item, geometryInputs: [geometryInput], graph: { ...graph, connections } }
  }) : raw.definitions
  const byId = new Map((Array.isArray(definitions) ? definitions : []).filter(isPlainObject).map((definition) => [definition.id, definition]))
  const graph = isPlainObject(raw.graph) ? raw.graph : {}
  const connections = Array.isArray(graph.connections) ? graph.connections.map((connection) => {
    if (!isPlainObject(connection) || connection.targetInput !== 'children' || typeof connection.target !== 'string') return connection
    const call = Array.isArray(graph.nodes) ? graph.nodes.find((node) => isPlainObject(node) && node.id === connection.target) : undefined
    const definitionId = isPlainObject(call?.parameters) ? call.parameters.definitionId : undefined
    const definition = typeof definitionId === 'string' ? byId.get(definitionId) : undefined
    const geometryInputs = isPlainObject(definition) && Array.isArray(definition.geometryInputs) ? definition.geometryInputs : []
    const first = geometryInputs[0]
    return isPlainObject(first) && typeof first.id === 'string'
      ? { ...connection, targetInput: moduleGeometryInputPortId(first.id) }
      : connection
  }) : graph.connections
  return { ...raw, version: 4, definitions, graph: { ...graph, connections } }
}

function validateV1(raw: Record<string, unknown>): ScadletProjectV1 {
  const metadata = validateMetadata(raw.metadata)
  const definitions = validateDefinitions(raw.definitions)
  const graph = validateGraph(raw.graph, 'main', undefined, definitions)
  const mainNodeIds = new Set(graph.nodes.map((node) => node.id))
  for (const definition of definitions) {
    for (const node of definition.graph.nodes) {
      if (mainNodeIds.has(node.id)) {
        throw new ScadletProjectError(`Node id "${node.id}" is shared by Main and a Module definition.`)
      }
    }
  }
  validateDefinitionCalls(graph, definitions)
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

/** `'main'` is the top-level project graph; `'module'`/`'function'` are a
 * definition's own graph, gated to their respective supported vocabulary. */
type GraphKind = 'main' | 'module' | 'function'

/** The subset of a definition's signature a connection/node validator needs,
 * shared by Module and Function definitions (a Function has no `geometryInputs`/has an optional `resultType`). */
interface DefinitionContext {
  interface: { inputs: string; output: string }
  parameters: readonly ModuleParameter[]
  geometryInputs?: readonly ModuleGeometryInput[]
  resultType?: FunctionResultType
}

function validateNode(raw: unknown, index: number, seenIds: Set<string>, graphKind: GraphKind): ScadletNodeDTO {
  if (!isPlainObject(raw)) throw new ScadletProjectError(`Node at index ${index} must be an object.`)

  if (typeof raw.id !== 'string' || raw.id.length === 0) {
    throw new ScadletProjectError(`Node at index ${index} is missing a valid "id".`)
  }
  if (seenIds.has(raw.id)) throw new ScadletProjectError(`Duplicate node id: "${raw.id}"`)
  seenIds.add(raw.id)

  if (typeof raw.type !== 'string') throw new ScadletProjectError(`Node "${raw.id}" is missing a "type".`)
  const entry = findCatalogEntry(raw.type)
  if (!entry) throw new ScadletProjectError(`Unknown node type: "${raw.type}"`)
  const isCall = entry.type === 'module-call' || entry.type === 'function-call'
  if (graphKind === 'main' && entry.palette === false && !isCall) {
    throw new ScadletProjectError(`Interface node "${raw.id}" belongs inside a definition, not Main.`)
  }
  if (graphKind === 'function' && entry.type === 'module-call') {
    throw new ScadletProjectError(`Module Call node "${raw.id}" is not supported inside a Function definition.`)
  }
  if (graphKind === 'function' && !FUNCTION_GRAPH_ALLOWED_NODE_TYPES.has(entry.type)) {
    throw new ScadletProjectError(`Node "${raw.id}" (${entry.type}) is not a supported node type inside a Function definition.`)
  }
  if (graphKind === 'module' && (entry.type === 'function-inputs' || entry.type === 'function-output')) {
    throw new ScadletProjectError(`Node "${raw.id}" (${entry.type}) belongs inside a Function definition, not a Module.`)
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
  definition?: DefinitionContext,
  definitions: readonly ScadletDefinition[] = [],
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
  const targetEntry = findCatalogEntry(targetNode.type)!
  const sourceCalledDefinition = sourceNode.type === 'function-call'
    ? definitions.find((item) => item.id === sourceNode.parameters.definitionId)
    : undefined
  const sourceDynamicType = sourceNode.type === 'module-inputs' && definition && sourceNode.id === definition.interface.inputs
    ? (geometryInputPort(definition.geometryInputs ?? [], sourceOutput) ? 'geometry' : parameterSocketType(definition.parameters, sourceOutput))
    : sourceNode.type === 'function-inputs' && definition && sourceNode.id === definition.interface.inputs
      ? parameterSocketType(definition.parameters, sourceOutput)
      : sourceCalledDefinition && sourceOutput === 'value'
        ? sourceCalledDefinition.kind === 'function' ? sourceCalledDefinition.resultType : undefined
        : undefined
  const targetCalledDefinition = targetNode.type === 'module-call' || targetNode.type === 'function-call'
    ? definitions.find((item) => item.id === targetNode.parameters.definitionId)
    : undefined
  const targetDynamicType = targetNode.type === 'function-output' && definition && targetNode.id === definition.interface.output && targetInput === 'result'
    ? definition.resultType
    : targetCalledDefinition
      ? (targetCalledDefinition.kind === 'module' && geometryInputPort(targetCalledDefinition.geometryInputs, targetInput) ? 'geometry' : parameterSocketType(targetCalledDefinition.parameters, targetInput))
      : undefined
  if (!sourceEntry.outputs.includes(sourceOutput) && !sourceDynamicType) {
    throw new ScadletProjectError(`Connection "${raw.id}" references unknown source port "${sourceOutput}" on node "${source}"`)
  }
  if (!targetEntry.inputs.includes(targetInput) && !targetEntry.isInputPort?.(targetInput, targetNode.parameters) && !targetDynamicType) {
    throw new ScadletProjectError(`Connection "${raw.id}" references unknown target port "${targetInput}" on node "${target}"`)
  }

  const sourceType = sourceDynamicType ?? sourceEntry.outputSocketType(sourceOutput, sourceNode.parameters)
  const targetType = targetDynamicType ?? targetEntry.inputSocketType(targetInput, targetNode.parameters)
  if (targetNode.type === 'conditional' && (targetInput === 'true' || targetInput === 'false') && targetNode.parameters.valueType === undefined) {
    throw new ScadletProjectError(`Conditional node "${targetNode.id}" has a branch connection but no inferred value type.`)
  }
  if (sourceNode.type === 'conditional' && sourceOutput === 'result' && sourceNode.parameters.valueType === undefined) {
    throw new ScadletProjectError(`Conditional node "${sourceNode.id}" has a Result connection but no inferred value type.`)
  }
  if (!sourceType || !targetType || sourceType !== targetType) {
    throw new ScadletProjectError(
      `Connection "${raw.id}" has incompatible socket types: ${sourceType ?? 'unknown'} output cannot connect to ${targetType ?? 'unknown'} input.`,
    )
  }

  return { id: raw.id, source, sourceOutput, target, targetInput }
}

function validateGraph(raw: unknown, graphKind: GraphKind, definition?: DefinitionContext, definitions: readonly ScadletDefinition[] = []): ScadletGraph {
  if (!isPlainObject(raw)) throw new ScadletProjectError('Project "graph" must be an object.')

  if (!Array.isArray(raw.nodes)) throw new ScadletProjectError('Project "graph.nodes" must be an array.')
  const seenNodeIds = new Set<string>()
  const nodes = raw.nodes.map((node, index) => validateNode(node, index, seenNodeIds, graphKind))
  const nodesById = new Map(nodes.map((node) => [node.id, node]))

  if (!Array.isArray(raw.connections)) throw new ScadletProjectError('Project "graph.connections" must be an array.')
  const seenConnectionIds = new Set<string>()
  const connections = raw.connections.map((connection, index) =>
    validateConnection(connection, index, seenConnectionIds, nodesById, definition, definitions),
  )
  const occupiedInputs = new Set<string>()
  for (const connection of connections) {
    const endpoint = `${connection.target}\u0000${connection.targetInput}`
    if (occupiedInputs.has(endpoint)) {
      throw new ScadletProjectError(`Multiple connections target input "${connection.targetInput}" on node "${connection.target}".`)
    }
    occupiedInputs.add(endpoint)
  }

  // Conditional's branch/result sockets are dynamic but their port IDs are
  // fixed. Validation therefore checks the persisted inference state as a
  // whole, rather than trusting a caller-provided socket label.
  for (const node of nodes.filter((item) => item.type === 'conditional')) {
    const valueType = node.parameters.valueType
    const branches = connections.filter((item) => item.target === node.id && (item.targetInput === 'true' || item.targetInput === 'false'))
    const resultConnections = connections.filter((item) => item.source === node.id && item.sourceOutput === 'result')
    if (valueType === undefined && (branches.length > 0 || resultConnections.length > 0)) {
      throw new ScadletProjectError(`Conditional node "${node.id}" has connected branches or Result but no inferred value type.`)
    }
    if (valueType !== undefined && branches.length === 0) {
      throw new ScadletProjectError(`Conditional node "${node.id}" has an inferred value type but no connected branch.`)
    }
    if (resultConnections.length > 0) {
      const incoming = new Set(connections.filter((item) => item.target === node.id).map((item) => item.targetInput))
      if (!incoming.has('condition') || !incoming.has('true') || !incoming.has('false')) {
        throw new ScadletProjectError(`Conditional node "${node.id}" has a Result connection but is incomplete.`)
      }
    }
  }

  return { nodes, connections }
}

function validateDefinitions(raw: unknown): ScadletDefinition[] {
  if (!Array.isArray(raw)) throw new ScadletProjectError('Project "definitions" must be an array.')
  // Resolve every signature before validating any definition graph. A
  // nested Function Call may legally target a Function that appears later
  // in project order, and its dynamic parameter/result sockets need that
  // complete registry during endpoint validation.
  const referenceDefinitions: ScadletDefinition[] = raw.map((item) => {
    if (!isPlainObject(item) || typeof item.id !== 'string' || !item.id
      || (item.kind !== 'module' && item.kind !== 'function') || typeof item.name !== 'string') {
      throw new ScadletProjectError('A definition has invalid identity metadata.')
    }
    const interfaceRoles = item.interface
    if (!isPlainObject(interfaceRoles) || typeof interfaceRoles.inputs !== 'string' || typeof interfaceRoles.output !== 'string') {
      throw new ScadletProjectError(`Definition "${item.id}" has invalid interface roles.`)
    }
    const parameters = validateModuleParameters(item.parameters)
    if (item.kind === 'module') {
      return { id: item.id, kind: 'module', name: item.name, interface: { inputs: interfaceRoles.inputs, output: interfaceRoles.output }, parameters, geometryInputs: validateModuleGeometryInputs(item.geometryInputs), graph: { nodes: [], connections: [] } }
    }
    let resultType: FunctionResultType | undefined
    if (item.resultType !== undefined) {
      if (item.resultType !== 'number' && item.resultType !== 'boolean' && item.resultType !== 'vector3') {
        throw new ScadletProjectError(`Function definition "${item.id}" has an invalid "resultType".`)
      }
      resultType = item.resultType
    }
    return { id: item.id, kind: 'function', name: item.name, interface: { inputs: interfaceRoles.inputs, output: interfaceRoles.output }, parameters, ...(resultType ? { resultType } : {}), graph: { nodes: [], connections: [] } }
  })
  const seenDefinitionIds = new Set<string>()
  const seenNames = new Set<string>()
  const seenNodeIds = new Set<string>()
  const definitions: ScadletDefinition[] = []
  for (const item of raw) {
    if (!isPlainObject(item)) throw new ScadletProjectError('Each definition must be an object.')
    if (typeof item.id !== 'string' || !item.id) throw new ScadletProjectError('A definition is missing a valid "id".')
    if (seenDefinitionIds.has(item.id)) throw new ScadletProjectError(`Duplicate definition id: "${item.id}"`)
    seenDefinitionIds.add(item.id)
    if (item.kind !== 'module' && item.kind !== 'function') throw new ScadletProjectError(`Definition "${item.id}" has an invalid "kind".`)
    if (typeof item.name !== 'string' || moduleNameProblem(item.name, seenNames) !== null) {
      throw new ScadletProjectError(`Definition "${item.id}" has an invalid or duplicate name.`)
    }
    seenNames.add(item.name)
    const interfaceRoles = item.interface
    if (!isPlainObject(interfaceRoles) || typeof interfaceRoles.inputs !== 'string' || typeof interfaceRoles.output !== 'string') {
      throw new ScadletProjectError(`Definition "${item.id}" has invalid interface roles.`)
    }

    if (item.kind === 'module') {
      const parameters = validateModuleParameters(item.parameters)
      const geometryInputs = validateModuleGeometryInputs(item.geometryInputs)
      const graph = validateGraph(item.graph, 'module', { interface: { inputs: interfaceRoles.inputs, output: interfaceRoles.output }, parameters, geometryInputs }, referenceDefinitions)
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
      const definition: ScadletModuleDefinition = {
        id: item.id,
        kind: 'module',
        name: item.name,
        interface: { inputs: interfaceRoles.inputs, output: interfaceRoles.output },
        parameters,
        geometryInputs,
        graph,
      }
      definitions.push(definition)
      continue
    }

    const parameters = validateModuleParameters(item.parameters)
    let resultType: FunctionResultType | undefined
    if (item.resultType !== undefined) {
      if (item.resultType !== 'number' && item.resultType !== 'boolean' && item.resultType !== 'vector3') {
        throw new ScadletProjectError(`Function definition "${item.id}" has an invalid "resultType".`)
      }
      resultType = item.resultType
    }
    const graph = validateGraph(item.graph, 'function', { interface: { inputs: interfaceRoles.inputs, output: interfaceRoles.output }, parameters, resultType }, referenceDefinitions)
    for (const node of graph.nodes) {
      if (seenNodeIds.has(node.id)) throw new ScadletProjectError(`Duplicate node id across definition graphs: "${node.id}"`)
      seenNodeIds.add(node.id)
    }
    const allInputs = graph.nodes.filter((node) => node.type === 'function-inputs')
    const allOutputs = graph.nodes.filter((node) => node.type === 'function-output')
    const inputs = allInputs.filter((node) => node.id === interfaceRoles.inputs)
    const outputs = allOutputs.filter((node) => node.id === interfaceRoles.output)
    if (allInputs.length !== 1 || inputs.length !== 1) throw new ScadletProjectError(`Function definition "${item.id}" must contain exactly one Inputs interface node.`)
    if (allOutputs.length !== 1 || outputs.length !== 1) throw new ScadletProjectError(`Function definition "${item.id}" must contain exactly one Output interface node.`)
    const output = outputs[0]
    if (output.type !== 'function-output') throw new ScadletProjectError(`Function definition "${item.id}" has an invalid Output interface node.`)
    const outputConnections = graph.connections.filter((connection) => connection.target === interfaceRoles.output && connection.targetInput === 'result')
    if (resultType === undefined && outputConnections.length > 0) {
      throw new ScadletProjectError(`Function definition "${item.id}" has a Function Output connection but no resolved result type.`)
    }
    if (resultType !== undefined && outputConnections.length !== 1) {
      throw new ScadletProjectError(`Function definition "${item.id}" must have exactly one connection into Function Output when its result type is resolved.`)
    }
    const definition: ScadletFunctionDefinition = {
      id: item.id,
      kind: 'function',
      name: item.name,
      interface: { inputs: interfaceRoles.inputs, output: interfaceRoles.output },
      parameters,
      ...(resultType !== undefined ? { resultType } : {}),
      graph,
    }
    definitions.push(definition)
  }
  for (const definition of definitions) validateDefinitionCalls(definition.graph, definitions)
  const dependencyAnalysis = analyzeFunctionDependencies(
    definitions.map((definition) => ({ id: definition.id, kind: definition.kind, outputNodeId: definition.interface.output })),
    definitions.flatMap((definition) => definition.graph.nodes.map((node) => ({
      id: node.id,
      scope: definition.id,
      ...(node.type === 'function-call' ? { calledFunctionId: String(node.parameters.definitionId) } : {}),
      ...(node.type === 'module-call' ? { calledModuleId: String(node.parameters.definitionId) } : {}),
    }))),
    definitions.flatMap((definition) => definition.graph.connections),
  )
  if (dependencyAnalysis.cycle) {
    const names = new Map(definitions.map((definition) => [definition.id, definition.name]))
    throw new ScadletProjectError(`Recursive Module dependencies are not supported yet: ${dependencyAnalysis.cycle.map((id) => names.get(id) ?? id).join(' → ')}.`)
  }
  return definitions
}

/** Calls are normal Main Geometry/value nodes, but their durable target is a
 * project definition ID rather than a copied display name. Resolve this only
 * after all definitions have been fully validated. Shared by Module Calls
 * (Geometry-producing) and Function Calls (typed-value-producing, and only
 * ever valid against an already-resolved Function). */
function validateDefinitionCalls(graph: ScadletGraph, definitions: readonly ScadletDefinition[]): void {
  const definitionsById = new Map(definitions.map((definition) => [definition.id, definition]))
  for (const node of graph.nodes) {
    if (node.type !== 'module-call' && node.type !== 'function-call') continue
    const definitionId = node.parameters.definitionId
    const definition = typeof definitionId === 'string' ? definitionsById.get(definitionId) : undefined
    const expectedKind = node.type === 'module-call' ? 'module' : 'function'
    if (!definition || definition.kind !== expectedKind) {
      throw new ScadletProjectError(`${node.type === 'module-call' ? 'Module' : 'Function'} Call node "${node.id}" references unknown ${expectedKind === 'module' ? 'Module' : 'Function'} definition "${String(definitionId)}".`)
    }
    const argumentsValue = node.parameters.arguments ?? {}
    if (typeof argumentsValue !== 'object' || argumentsValue === null || Array.isArray(argumentsValue)) throw new ScadletProjectError(`Call node "${node.id}" has invalid argument fallbacks.`)
    for (const [parameterId, value] of Object.entries(argumentsValue)) {
      const parameter = definition.parameters.find((item) => item.id === parameterId)
      if (!parameter) throw new ScadletProjectError(`Call node "${node.id}" has a fallback for unknown parameter "${parameterId}".`)
      if (!moduleParameterDefaultIsValid(parameter.type, value)) throw new ScadletProjectError(`Call node "${node.id}" has an invalid fallback for parameter "${parameter.name}".`)
    }
  }
}

function validateModuleParameters(raw: unknown): ModuleParameter[] {
  if (raw === undefined) return []
  if (!Array.isArray(raw)) throw new ScadletProjectError('Module "parameters" must be an array.')
  const ids = new Set<string>(); const names = new Set<string>()
  return raw.map((item, index) => {
    if (!isPlainObject(item) || typeof item.id !== 'string' || !item.id || typeof item.name !== 'string') throw new ScadletProjectError(`Module parameter at index ${index} is invalid.`)
    if (ids.has(item.id)) throw new ScadletProjectError(`Duplicate Module parameter id "${item.id}".`)
    ids.add(item.id)
    if (moduleParameterNameProblem(item.name, names) !== null) throw new ScadletProjectError(`Module parameter "${item.name}" has an invalid or duplicate name.`)
    names.add(item.name)
    if (item.type !== 'number' && item.type !== 'boolean' && item.type !== 'vector3') throw new ScadletProjectError(`Module parameter "${item.name}" has an unsupported type.`)
    const type = item.type as ModuleParameterType
    if (!moduleParameterDefaultIsValid(type, item.default)) throw new ScadletProjectError(`Module parameter "${item.name}" has an invalid default.`)
    return { id: item.id, name: item.name, type, default: item.default }
  })
}

function validateModuleGeometryInputs(raw: unknown): ModuleGeometryInput[] {
  if (!Array.isArray(raw)) throw new ScadletProjectError('Module "geometryInputs" must be an array.')
  const ids = new Set<string>()
  return raw.map((item, index) => {
    if (!isPlainObject(item) || typeof item.id !== 'string' || !item.id || typeof item.name !== 'string' || !item.name.trim()) {
      throw new ScadletProjectError(`Module Geometry input at index ${index} is invalid.`)
    }
    if (ids.has(item.id)) throw new ScadletProjectError(`Duplicate Module Geometry input id "${item.id}".`)
    ids.add(item.id)
    return { id: item.id, name: item.name }
  })
}

function parameterSocketType(parameters: readonly ModuleParameter[], port: string): 'number' | 'boolean' | 'vector3' | undefined {
  const parameter = parameters.find((item) => moduleParameterPortId(item.id) === port)
  return parameter?.type
}

function geometryInputPort(inputs: readonly ModuleGeometryInput[], port: string): ModuleGeometryInput | undefined {
  return inputs.find((input) => moduleGeometryInputPortId(input.id) === port)
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

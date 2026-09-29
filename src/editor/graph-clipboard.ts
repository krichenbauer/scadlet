import type { Position } from './coordinates'
import type { NodeTypeId } from './node-catalog'

export type GraphClipboardCommand = 'copy' | 'cut' | 'paste' | 'duplicate'

export interface GraphClipboardNodeSnapshot {
  readonly id: string
  readonly type: NodeTypeId
  readonly label: string
  readonly position: Position
  readonly parameters: Readonly<Record<string, unknown>>
  readonly collapsed: boolean
}

export interface GraphClipboardConnectionSnapshot {
  readonly id: string
  readonly source: string
  readonly sourceOutput: string
  readonly target: string
  readonly targetInput: string
}

/** A plain, detached, session-only graph fragment. It deliberately mirrors
 * the canonical node/connection data boundary without becoming persisted
 * project state or retaining live Rete objects. */
export interface GraphClipboardPayload {
  readonly projectId: string
  readonly scope: string | null
  readonly nodes: readonly GraphClipboardNodeSnapshot[]
  readonly connections: readonly GraphClipboardConnectionSnapshot[]
}

export interface PlannedClipboardNode extends GraphClipboardNodeSnapshot {
  readonly sourceId: string
  readonly portIds: ReadonlyMap<string, string>
}

export interface PlannedClipboardConnection extends GraphClipboardConnectionSnapshot {
  readonly sourceConnectionId: string
}

export interface GraphClipboardPastePlan {
  readonly nodes: readonly PlannedClipboardNode[]
  readonly connections: readonly PlannedClipboardConnection[]
  readonly structuralPairs: readonly { headerId: string; resultId: string }[]
}

export function graphClipboardCommandForKey(
  event: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>,
  applePlatform: boolean,
): GraphClipboardCommand | null {
  const commandModifier = applePlatform
    ? event.metaKey && !event.ctrlKey
    : event.ctrlKey && !event.metaKey
  if (!commandModifier || event.altKey || event.shiftKey) return null
  switch (event.key.toLowerCase()) {
    case 'c': return 'copy'
    case 'x': return 'cut'
    case 'v': return 'paste'
    case 'd': return 'duplicate'
    default: return null
  }
}

/** Clipboard shortcuts must leave text selection and native editing alone.
 * Buttons are intentionally not included: a graph menu button is still graph
 * context, while input/select/textarea/contenteditable are native editors. */
export function isNativeClipboardEditingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return target instanceof HTMLInputElement
    || target instanceof HTMLTextAreaElement
    || target instanceof HTMLSelectElement
    || target.isContentEditable
}

export function nextCopiedBindingName(name: string, unavailable: ReadonlySet<string>): string {
  if (!unavailable.has(name)) return name
  const base = `${name}_copy`
  if (!unavailable.has(base)) return base
  let ordinal = 2
  while (unavailable.has(`${base}_${ordinal}`)) ordinal += 1
  return `${base}_${ordinal}`
}

export function internalGraphClipboardConnections(
  connections: readonly GraphClipboardConnectionSnapshot[],
  nodeIds: ReadonlySet<string>,
): GraphClipboardConnectionSnapshot[] {
  return connections.filter((connection) =>
    nodeIds.has(connection.source)
      && nodeIds.has(connection.target)
      && connection.sourceOutput !== 'loop'
      && connection.targetInput !== 'loop',
  ).map((connection) => detached(connection))
}

function detached<T>(value: T): T {
  return structuredClone(value)
}

function remapChildPorts(
  type: NodeTypeId,
  parameters: Record<string, unknown>,
  id: () => string,
): ReadonlyMap<string, string> {
  const mapping = new Map<string, string>()
  if (!['difference', 'union', 'intersection', 'for-result'].includes(type)) return mapping
  const children = parameters.children
  if (!Array.isArray(children)) return mapping
  parameters.children = children.map((child, index) => {
    const oldId = typeof child === 'object' && child !== null && typeof (child as { id?: unknown }).id === 'string'
      ? (child as { id: string }).id
      : ''
    const newId = id()
    const oldPort = type === 'difference' && index < 2 ? (index === 0 ? 'base' : 'subtract') : `child:${oldId}`
    const newPort = type === 'difference' && index < 2 ? oldPort : `child:${newId}`
    mapping.set(oldPort, newPort)
    return { id: newId }
  })
  return mapping
}

/** Creates every fresh identity before live graph mutation. The caller still
 * validates the complete hypothetical destination graph before commit. */
export function planGraphClipboardPaste(
  payload: GraphClipboardPayload,
  unavailableBindingNames: ReadonlySet<string>,
  id: () => string = () => crypto.randomUUID(),
): GraphClipboardPastePlan {
  const nodeIds = new Map(payload.nodes.map((node) => [node.id, id()]))
  const bindingIds = new Map<string, string>()
  const pairIds = new Map<string, string>()
  const usedNames = new Set(unavailableBindingNames)

  for (const snapshot of payload.nodes) {
    const parameters = snapshot.parameters
    if (snapshot.type === 'for') {
      if (typeof parameters.bindingId === 'string') bindingIds.set(parameters.bindingId, id())
      if (typeof parameters.pairId === 'string') pairIds.set(parameters.pairId, id())
    } else if (['number', 'boolean', 'vector3'].includes(snapshot.type) && typeof parameters.bindingId === 'string') {
      bindingIds.set(parameters.bindingId, id())
    }
  }

  const nodes = payload.nodes.map<PlannedClipboardNode>((snapshot) => {
    const parameters = detached(snapshot.parameters) as Record<string, unknown>
    if (snapshot.type === 'for') {
      if (typeof parameters.bindingId === 'string') parameters.bindingId = bindingIds.get(parameters.bindingId)!
      if (typeof parameters.pairId === 'string') parameters.pairId = pairIds.get(parameters.pairId)!
    } else if (snapshot.type === 'for-result') {
      if (typeof parameters.pairId === 'string') parameters.pairId = pairIds.get(parameters.pairId)!
    } else if (snapshot.type === 'variable-reference' && typeof parameters.bindingId === 'string') {
      parameters.bindingId = bindingIds.get(parameters.bindingId) ?? parameters.bindingId
    } else if (['number', 'boolean', 'vector3'].includes(snapshot.type) && typeof parameters.bindingId === 'string') {
      parameters.bindingId = bindingIds.get(parameters.bindingId)!
      if (typeof parameters.name === 'string') {
        const copiedName = nextCopiedBindingName(parameters.name, usedNames)
        parameters.name = copiedName
        usedNames.add(copiedName)
      }
    }
    return {
      ...snapshot,
      sourceId: snapshot.id,
      id: nodeIds.get(snapshot.id)!,
      position: detached(snapshot.position),
      parameters,
      portIds: remapChildPorts(snapshot.type, parameters, id),
    }
  })
  const plannedBySourceId = new Map(nodes.map((node) => [node.sourceId, node]))
  const connections = payload.connections.map<PlannedClipboardConnection>((connection) => {
    const source = plannedBySourceId.get(connection.source)!
    const target = plannedBySourceId.get(connection.target)!
    return {
      ...connection,
      sourceConnectionId: connection.id,
      id: id(),
      source: source.id,
      sourceOutput: source.portIds.get(connection.sourceOutput) ?? connection.sourceOutput,
      target: target.id,
      targetInput: target.portIds.get(connection.targetInput) ?? connection.targetInput,
    }
  })
  const resultsByPair = new Map(nodes
    .filter((node) => node.type === 'for-result' && typeof node.parameters.pairId === 'string')
    .map((node) => [String(node.parameters.pairId), node.id]))
  const structuralPairs = nodes.flatMap((node) => node.type === 'for' && typeof node.parameters.pairId === 'string'
    ? [{ headerId: node.id, resultId: resultsByPair.get(String(node.parameters.pairId))! }]
    : [])
  if (structuralPairs.some((pair) => !pair.resultId)) throw new Error('For nodes must remain a complete pair.')
  return { nodes, connections, structuralPairs }
}

export function cloneGraphClipboardPayload(payload: GraphClipboardPayload): GraphClipboardPayload {
  return detached(payload)
}

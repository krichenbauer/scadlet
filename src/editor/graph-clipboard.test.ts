import { describe, expect, it } from 'vitest'

import {
  cloneGraphClipboardPayload,
  graphClipboardCommandForKey,
  internalGraphClipboardConnections,
  nextCopiedBindingName,
  planGraphClipboardPaste,
  type GraphClipboardPayload,
} from './graph-clipboard'

const key = (value: string, modifiers: Partial<Pick<KeyboardEvent, 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>> = {}) => ({
  key: value,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  ...modifiers,
})

describe('graph clipboard shortcuts', () => {
  it('maps Command on Apple platforms and Control on Windows/Linux', () => {
    expect(graphClipboardCommandForKey(key('c', { metaKey: true }), true)).toBe('copy')
    expect(graphClipboardCommandForKey(key('X', { metaKey: true }), true)).toBe('cut')
    expect(graphClipboardCommandForKey(key('v', { ctrlKey: true }), false)).toBe('paste')
    expect(graphClipboardCommandForKey(key('D', { ctrlKey: true }), false)).toBe('duplicate')
  })

  it('does not accept the wrong platform modifier or modified variants', () => {
    expect(graphClipboardCommandForKey(key('c', { ctrlKey: true }), true)).toBeNull()
    expect(graphClipboardCommandForKey(key('c', { metaKey: true }), false)).toBeNull()
    expect(graphClipboardCommandForKey(key('d', { ctrlKey: true, shiftKey: true }), false)).toBeNull()
    expect(graphClipboardCommandForKey(key('v', { ctrlKey: true, altKey: true }), false)).toBeNull()
  })
})

describe('graph clipboard remapping', () => {
  it('copies only ordinary connections wholly inside the selected node set', () => {
    const connections = [
      { id: 'inside', source: 'a', sourceOutput: 'geometry', target: 'b', targetInput: 'geometry' },
      { id: 'outgoing', source: 'b', sourceOutput: 'geometry', target: 'c', targetInput: 'geometry' },
      { id: 'structure', source: 'a', sourceOutput: 'loop', target: 'b', targetInput: 'loop' },
    ]
    expect(internalGraphClipboardConnections(connections, new Set(['a', 'b']))).toEqual([connections[0]])
  })

  it('uses deterministic valid conflict-free copied binding names', () => {
    expect(nextCopiedBindingName('width', new Set())).toBe('width')
    expect(nextCopiedBindingName('width', new Set(['width']))).toBe('width_copy')
    expect(nextCopiedBindingName('width', new Set(['width', 'width_copy', 'width_copy_2']))).toBe('width_copy_3')
  })

  it('deeply detaches clipboard snapshots from their source objects', () => {
    const source: GraphClipboardPayload = {
      projectId: 'project', scope: null, connections: [],
      nodes: [{ id: 'n', type: 'number', label: 'Number', position: { x: 1, y: 2 }, parameters: { value: 3, name: 'n' }, collapsed: false }],
    }
    const copy = cloneGraphClipboardPayload(source)
    ;(source.nodes[0]!.parameters as { value: number }).value = 99
    source.nodes[0]!.position.x = 88
    expect(copy.nodes[0]).toMatchObject({ position: { x: 1, y: 2 }, parameters: { value: 3 } })
  })

  it('freshens nodes, connections, bindings, For pairs, child ports, and internal references', () => {
    const payload: GraphClipboardPayload = {
      projectId: 'project', scope: null,
      nodes: [
        { id: 'value', type: 'number', label: 'Number', position: { x: 0, y: 0 }, parameters: { value: 4, name: 'width', bindingId: 'binding' }, collapsed: false },
        { id: 'reference', type: 'variable-reference', label: 'Variable reference', position: { x: 20, y: 0 }, parameters: { bindingId: 'binding' }, collapsed: false },
        { id: 'external-reference', type: 'variable-reference', label: 'Variable reference', position: { x: 40, y: 0 }, parameters: { bindingId: 'parameter-binding' }, collapsed: false },
        { id: 'header', type: 'for', label: 'For', position: { x: 0, y: 80 }, parameters: { pairId: 'pair', bindingId: 'iterator', name: 'i', start: 0, step: 1, end: 4 }, collapsed: false },
        { id: 'result', type: 'for-result', label: 'For result', position: { x: 220, y: 80 }, parameters: { pairId: 'pair', children: [{ id: 'body' }, { id: 'empty' }] }, collapsed: true },
      ],
      connections: [
        { id: 'edge', source: 'reference', sourceOutput: 'value', target: 'header', targetInput: 'end' },
        { id: 'body-edge', source: 'result', sourceOutput: 'geometry', target: 'result', targetInput: 'child:body' },
      ],
    }
    let ordinal = 0
    const plan = planGraphClipboardPaste(payload, new Set(['width', 'width_copy']), () => `fresh-${++ordinal}`)
    expect(new Set(plan.nodes.map((node) => node.id)).size).toBe(payload.nodes.length)
    expect(plan.connections.every((connection) => connection.id.startsWith('fresh-'))).toBe(true)
    const value = plan.nodes.find((node) => node.sourceId === 'value')!
    const reference = plan.nodes.find((node) => node.sourceId === 'reference')!
    const external = plan.nodes.find((node) => node.sourceId === 'external-reference')!
    const header = plan.nodes.find((node) => node.sourceId === 'header')!
    const result = plan.nodes.find((node) => node.sourceId === 'result')!
    expect(value.parameters.name).toBe('width_copy_2')
    expect(reference.parameters.bindingId).toBe(value.parameters.bindingId)
    expect(external.parameters.bindingId).toBe('parameter-binding')
    expect(header.parameters.pairId).toBe(result.parameters.pairId)
    expect(header.parameters.bindingId).not.toBe('iterator')
    expect(result.parameters.children).not.toEqual(payload.nodes[4]!.parameters.children)
    expect(plan.connections.find((edge) => edge.sourceConnectionId === 'body-edge')?.targetInput).not.toBe('child:body')
    expect(plan.structuralPairs).toEqual([{ headerId: header.id, resultId: result.id }])
  })

  it('remaps Min / Max operand port ids while retaining values, order, and its empty trailing slot', () => {
    const payload: GraphClipboardPayload = {
      projectId: 'project', scope: null,
      nodes: [{ id: 'minmax', type: 'min-max', label: 'Min / Max', position: { x: 0, y: 0 }, parameters: { operation: 'maximum', operands: [{ id: 'a', value: 0 }, { id: 'b', value: 1 }, { id: 'middle', value: 3 }, { id: 'tail' }] }, collapsed: false }],
      connections: [],
    }
    let ordinal = 0
    const plan = planGraphClipboardPaste(payload, new Set(), () => `fresh-${++ordinal}`)
    const operands = plan.nodes[0]!.parameters.operands as { id: string; value?: number }[]
    expect(operands).toEqual([{ id: 'a', value: 0 }, { id: 'b', value: 1 }, { id: 'fresh-2', value: 3 }, { id: 'fresh-3' }])
    expect(plan.nodes[0]!.portIds.get('operand:middle')).toBe('operand:fresh-2')
  })

  it('rejects an incomplete For pair before live graph mutation', () => {
    const payload: GraphClipboardPayload = {
      projectId: 'project', scope: null, connections: [],
      nodes: [{
        id: 'header', type: 'for', label: 'For', position: { x: 0, y: 0 },
        parameters: { pairId: 'pair', bindingId: 'iterator', name: 'i', start: 0, step: 1, end: 4 },
        collapsed: false,
      }],
    }
    expect(() => planGraphClipboardPaste(payload, new Set(), () => crypto.randomUUID())).toThrow('complete pair')
  })
})

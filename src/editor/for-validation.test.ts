import { describe, expect, it } from 'vitest'

import { loopProblemFeedback, loopStructureProblem, type LoopGraphConnection, type LoopGraphNode } from './for-validation'

function header(id: string, pair: string, name: string): LoopGraphNode {
  return { id, type: 'for', parameters: { pairId: pair, bindingId: `${id}-binding`, name, start: 0, step: 1, end: 3 } }
}
function result(id: string, pair: string): LoopGraphNode {
  return { id, type: 'for-result', parameters: { pairId: pair, children: [{ id: 'body' }, { id: 'next' }] } }
}
function geometry(id: string, type: 'cube' | 'translate'): LoopGraphNode {
  return { id, type, parameters: type === 'cube' ? {} : { x: 0, y: 0, z: 0, representation: 'xyz' } }
}
function edge(source: string, sourceOutput: string, target: string, targetInput: string): LoopGraphConnection {
  return { id: `${source}.${sourceOutput}->${target}.${targetInput}`, source, sourceOutput, target, targetInput }
}

/** Outer loop `a` whose body is the nested loop `b`; `b` translates a cube
 * by its own iterator. Both iterators are named as given. */
function nested(outerName: string, innerName: string) {
  const nodes = [
    header('a', 'A', outerName), result('ra', 'A'),
    header('b', 'B', innerName), result('rb', 'B'),
    geometry('cube', 'cube'), geometry('move', 'translate'),
  ]
  const connections = [
    edge('a', 'loop', 'ra', 'loop'), edge('b', 'loop', 'rb', 'loop'),
    edge('cube', 'geometry', 'move', 'geometry'), edge('b', 'value', 'move', 'x'),
    edge('move', 'geometry', 'rb', 'child:body'), edge('rb', 'geometry', 'ra', 'child:body'),
  ]
  return { nodes, connections }
}

describe('For iterator name reuse', () => {
  it('lets independent sibling loops share a name', () => {
    const nodes = [header('a', 'A', 'i'), result('ra', 'A'), header('b', 'B', 'i'), result('rb', 'B')]
    const connections = [edge('a', 'loop', 'ra', 'loop'), edge('b', 'loop', 'rb', 'loop')]
    expect(loopStructureProblem(nodes, connections)).toBeNull()
  })

  it('lets a nested loop reuse the enclosing name when only its range uses the enclosing iterator', () => {
    const graph = nested('i', 'i')
    expect(loopStructureProblem(graph.nodes, graph.connections)).toBeNull()
    graph.connections.push(edge('a', 'value', 'b', 'end'))
    expect(loopStructureProblem(graph.nodes, graph.connections)).toBeNull()
  })

  it('rejects reuse when the enclosing iterator is wired into the nested body', () => {
    const graph = nested('i', 'i')
    graph.connections.push(edge('a', 'value', 'move', 'y'))
    expect(loopStructureProblem(graph.nodes, graph.connections)).toMatchObject({ code: 'shadow', iteratorName: 'i' })
    // Distinct names make the same wiring unambiguous.
    const distinct = nested('i', 'j')
    distinct.connections.push(edge('a', 'value', 'move', 'y'))
    expect(loopStructureProblem(distinct.nodes, distinct.connections)).toBeNull()
  })

  it('rejects reuse when a Variable reference to the enclosing iterator is used in the nested body', () => {
    const graph = nested('i', 'i')
    graph.nodes.push({ id: 'ref', type: 'variable-reference', parameters: { bindingId: 'a-binding' } })
    graph.connections.push(edge('ref', 'value', 'move', 'y'))
    expect(loopStructureProblem(graph.nodes, graph.connections)?.code).toBe('shadow')
  })

  it('treats the range of a deeper loop inside the nested body as part of that body', () => {
    // a(i) > b(i) > c(k): the outer `i` feeding c's End is evaluated inside
    // b's body, where `i` already names b's iterator.
    const threeLevels = (outerTarget: 'b' | 'c') => ({
      nodes: [
        header('a', 'A', 'i'), result('ra', 'A'), header('b', 'B', 'i'), result('rb', 'B'),
        header('c', 'C', 'k'), result('rc', 'C'), geometry('cube', 'cube'),
      ],
      connections: [
        edge('a', 'loop', 'ra', 'loop'), edge('b', 'loop', 'rb', 'loop'), edge('c', 'loop', 'rc', 'loop'),
        edge('cube', 'geometry', 'rc', 'child:body'), edge('rc', 'geometry', 'rb', 'child:body'),
        edge('rb', 'geometry', 'ra', 'child:body'), edge('a', 'value', outerTarget, 'end'),
      ],
    })
    const intoDeeperRange = threeLevels('c')
    expect(loopStructureProblem(intoDeeperRange.nodes, intoDeeperRange.connections)?.code).toBe('shadow')
    // Feeding b's own range instead stays in the enclosing scope and is valid.
    const intoOwnRange = threeLevels('b')
    expect(loopStructureProblem(intoOwnRange.nodes, intoOwnRange.connections)).toBeNull()
  })

  it('still rejects an iterator named like a Value or parameter of its scope', () => {
    const graph = nested('i', 'j')
    expect(loopStructureProblem(graph.nodes, graph.connections, new Set(['j']))).toMatchObject({ code: 'name', iteratorName: 'j' })
  })

  it('explains each refusal with a specific localized message', () => {
    expect(loopProblemFeedback({ code: 'shadow', message: '', iteratorName: 'i' })).toBe(
      'The inner For reuses the name "i", but its body also uses the outer "i". Rename one of them.',
    )
    expect(loopProblemFeedback({ code: 'name', message: '', iteratorName: 'j' })).toBe(
      'The For iterator "j" has the same name as a Value or parameter in this scope. Rename one of them.',
    )
    expect(loopProblemFeedback({ code: 'escape', message: '' })).toBe('A For iterator can only contribute to its matching For result body.')
    expect(loopProblemFeedback({ code: 'pair', message: '' })).toBe('For nodes must remain a complete pair in one scope.')
  })
})

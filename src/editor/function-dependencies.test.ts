import { describe, expect, it } from 'vitest'

import { analyzeFunctionDependencies } from './function-dependencies'

const definitions = [
  { id: 'a', kind: 'function' as const, outputNodeId: 'a-out' },
  { id: 'b', kind: 'function' as const, outputNodeId: 'b-out' },
  { id: 'c', kind: 'function' as const, outputNodeId: 'c-out' },
]

function node(id: string, scope: string, calledFunctionId?: string) {
  return { id, scope, ...(calledFunctionId ? { calledFunctionId } : {}) }
}

describe('effective Function dependencies', () => {
  it('orders callees before callers deterministically', () => {
    const analysis = analyzeFunctionDependencies(definitions, [
      node('a-out', 'a'), node('b-out', 'b'), node('c-out', 'c'),
      node('a-calls-b', 'a', 'b'), node('b-calls-c', 'b', 'c'), node('c-value', 'c'),
    ], [
      { source: 'a-calls-b', target: 'a-out' },
      { source: 'b-calls-c', target: 'b-out' },
      { source: 'c-value', target: 'c-out' },
    ])
    expect(analysis.cycle).toBeUndefined()
    expect(analysis.order).toEqual(['c', 'b', 'a'])
  })

  it('reports direct recursion without mutating the supplied graph', () => {
    const nodes = [node('a-out', 'a'), node('a-call', 'a', 'a')]
    const connections = [{ source: 'a-call', target: 'a-out' }]
    const before = JSON.stringify({ nodes, connections })
    expect(analyzeFunctionDependencies(definitions, nodes, connections).cycle).toEqual(['a', 'a'])
    expect(JSON.stringify({ nodes, connections })).toBe(before)
  })

  it('reports indirect recursion but allows an acyclic chain', () => {
    const nodes = [
      node('a-out', 'a'), node('b-out', 'b'), node('c-out', 'c'),
      node('a-call', 'a', 'b'), node('b-call', 'b', 'c'), node('c-call', 'c', 'a'),
    ]
    const chain = [
      { source: 'a-call', target: 'a-out' },
      { source: 'b-call', target: 'b-out' },
    ]
    expect(analyzeFunctionDependencies(definitions, nodes, chain).cycle).toBeUndefined()
    expect(analyzeFunctionDependencies(definitions, nodes, [...chain, { source: 'c-call', target: 'c-out' }]).cycle).toEqual(['a', 'b', 'c', 'a'])
  })

  it('ignores a disconnected/dead Function Call', () => {
    const analysis = analyzeFunctionDependencies(definitions, [
      node('a-out', 'a'), node('a-value', 'a'), node('dead-call', 'a', 'b'),
      node('b-out', 'b'), node('b-call', 'b', 'a'),
    ], [
      { source: 'a-value', target: 'a-out' },
      { source: 'b-call', target: 'b-out' },
    ])
    expect(analysis.dependencies.get('a')).toEqual(new Set())
    expect(analysis.dependencies.get('b')).toEqual(new Set(['a']))
    expect(analysis.cycle).toBeUndefined()
  })
})

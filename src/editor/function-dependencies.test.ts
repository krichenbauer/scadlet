import { describe, expect, it } from 'vitest'

import { analyzeFunctionDependencies } from './function-dependencies'

const definitions = [
  { id: 'a', kind: 'function' as const, outputNodeId: 'a-out' },
  { id: 'b', kind: 'function' as const, outputNodeId: 'b-out' },
  { id: 'c', kind: 'function' as const, outputNodeId: 'c-out' },
]

function node(id: string, scope: string, calledFunctionId?: string, calledModuleId?: string) {
  return { id, scope, ...(calledFunctionId ? { calledFunctionId } : {}), ...(calledModuleId ? { calledModuleId } : {}) }
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
    expect(analysis.functionComponents).toEqual([
      { members: ['c'], recursive: false },
      { members: ['b'], recursive: false },
      { members: ['a'], recursive: false },
    ])
  })

  it('accepts direct recursion as one deterministic SCC without mutating the supplied graph', () => {
    const nodes = [node('a-out', 'a'), node('a-call', 'a', 'a')]
    const connections = [{ source: 'a-call', target: 'a-out' }]
    const before = JSON.stringify({ nodes, connections })
    expect(analyzeFunctionDependencies(definitions, nodes, connections)).toMatchObject({
      order: ['a', 'b', 'c'],
      functionComponents: [
        { members: ['a'], recursive: true },
        { members: ['b'], recursive: false },
        { members: ['c'], recursive: false },
      ],
    })
    expect(JSON.stringify({ nodes, connections })).toBe(before)
  })

  it('accepts mutual recursion and keeps SCC members in project order', () => {
    const nodes = [
      node('a-out', 'a'), node('b-out', 'b'), node('c-out', 'c'),
      node('a-call', 'a', 'b'), node('b-call', 'b', 'c'), node('c-call', 'c', 'a'),
    ]
    const chain = [
      { source: 'a-call', target: 'a-out' },
      { source: 'b-call', target: 'b-out' },
    ]
    expect(analyzeFunctionDependencies(definitions, nodes, chain).order).toEqual(['c', 'b', 'a'])
    const recursiveConnections = [...chain, { source: 'c-call', target: 'c-out' }]
    const recursive = analyzeFunctionDependencies(definitions, nodes, recursiveConnections)
    expect(recursive.cycle).toBeUndefined()
    expect(recursive.order).toEqual(['a', 'b', 'c'])
    expect(recursive.functionComponents).toEqual([{ members: ['a', 'b', 'c'], recursive: true }])
    expect(analyzeFunctionDependencies(definitions, nodes, recursiveConnections.toReversed()).order).toEqual(['a', 'b', 'c'])
  })

  it('orders acyclic callees before and callers after a recursive SCC', () => {
    const extended = [
      { id: 'after', kind: 'function' as const, outputNodeId: 'after-out' },
      { id: 'a', kind: 'function' as const, outputNodeId: 'a-out' },
      { id: 'b', kind: 'function' as const, outputNodeId: 'b-out' },
      { id: 'before', kind: 'function' as const, outputNodeId: 'before-out' },
    ]
    const analysis = analyzeFunctionDependencies(extended, [
      node('after-out', 'after'), node('after-call', 'after', 'a'),
      node('a-out', 'a'), node('a-b', 'a', 'b'), node('a-before', 'a', 'before'),
      node('b-out', 'b'), node('b-a', 'b', 'a'),
      node('before-out', 'before'), node('before-value', 'before'),
    ], [
      { source: 'after-call', target: 'after-out' },
      { source: 'a-b', target: 'a-out' },
      { source: 'a-before', target: 'a-out' },
      { source: 'b-a', target: 'b-out' },
      { source: 'before-value', target: 'before-out' },
    ])
    expect(analysis.order).toEqual(['before', 'a', 'b', 'after'])
    expect(analysis.functionComponents).toEqual([
      { members: ['before'], recursive: false },
      { members: ['a', 'b'], recursive: true },
      { members: ['after'], recursive: false },
    ])
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

  it('follows all effective If inputs but ignores Calls in a dead If', () => {
    const moduleDefinitions = [
      { id: 'a', kind: 'module' as const, outputNodeId: 'a-out' },
      { id: 'b', kind: 'module' as const, outputNodeId: 'b-out' },
      { id: 'c', kind: 'module' as const, outputNodeId: 'c-out' },
    ]
    const nodes = [
      node('a-out', 'a'), node('a-if', 'a'), node('condition-call', 'a', 'b'),
      node('then-call', 'a', undefined, 'c'), node('else-call', 'a', undefined, 'b'),
      node('dead-if', 'a'), node('dead-call', 'a', undefined, 'a'),
      node('b-out', 'b'), node('c-out', 'c'),
    ]
    const analysis = analyzeFunctionDependencies(moduleDefinitions, nodes, [
      { source: 'a-if', target: 'a-out' },
      { source: 'condition-call', target: 'a-if' },
      { source: 'then-call', target: 'a-if' },
      { source: 'else-call', target: 'a-if' },
      { source: 'dead-call', target: 'dead-if' },
    ])
    expect(analysis.dependencies.get('a')).toEqual(new Set(['b', 'c']))
    expect(analysis.cycle).toBeUndefined()
  })

  it('orders effective nested Module Calls and rejects only live Module recursion', () => {
    const moduleDefinitions = [
      { id: 'outer', kind: 'module' as const, outputNodeId: 'outer-out' },
      { id: 'middle', kind: 'module' as const, outputNodeId: 'middle-out' },
      { id: 'inner', kind: 'module' as const, outputNodeId: 'inner-out' },
    ]
    const nodes = [
      node('outer-out', 'outer'), node('outer-middle', 'outer', undefined, 'middle'),
      node('middle-out', 'middle'), node('middle-inner', 'middle', undefined, 'inner'),
      node('inner-out', 'inner'), node('inner-cube', 'inner'),
      node('dead-recursion', 'inner', undefined, 'outer'),
    ]
    const chain = [
      { source: 'outer-middle', target: 'outer-out' },
      { source: 'middle-inner', target: 'middle-out' },
      { source: 'inner-cube', target: 'inner-out' },
    ]
    const acyclic = analyzeFunctionDependencies(moduleDefinitions, nodes, chain)
    expect(acyclic.moduleOrder).toEqual(['inner', 'middle', 'outer'])
    expect(acyclic.cycle).toBeUndefined()
    expect(analyzeFunctionDependencies(moduleDefinitions, nodes, [...chain, { source: 'dead-recursion', target: 'inner-out' }])).toMatchObject({ cycle: ['outer', 'middle', 'inner', 'outer'], cycleKind: 'module' })
  })
})

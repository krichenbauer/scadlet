import { describe, expect, it } from 'vitest'

import { ForHeaderNode, ForResultNode } from './for-nodes'

describe('For nodes', () => {
  it('never stores a literal zero Step, keeping the previous saveable value', () => {
    const header = new ForHeaderNode({ pairId: 'pair', bindingId: 'iterator', name: 'i', start: 0, step: 2, end: 10 })
    expect(header.controls.step.rejectionFor?.(0)).toBe('For step must not be zero.')
    expect(header.controls.step.rejectionFor?.(-1)).toBeNull()
    header.controls.step.setValue(0)
    expect(header.getPersistedParams().step).toBe(2)
    header.controls.step.setValue(-0.5)
    expect(header.getPersistedParams().step).toBe(-0.5)
    // Start and End keep ordinary literal semantics, including zero.
    expect(header.controls.start.rejectionFor).toBeUndefined()
    header.controls.end.setValue(0)
    expect(header.getPersistedParams().end).toBe(0)
  })

  it('uses connected range expressions without erasing direct fallbacks', () => {
    const header = new ForHeaderNode({ pairId: 'pair', bindingId: 'iterator', name: 'i', start: 0, step: 1, end: 10 })
    expect(header.data({ start: [{ code: 'offset' }], step: [{ code: 'stride' }], end: [{ code: 'count' }] }).loop).toMatchObject({
      start: 'offset', step: 'stride', end: 'count', iterator: 'i',
    })
    expect(header.getPersistedParams()).toMatchObject({ start: 0, step: 1, end: 10 })
    expect(header.data({}).loop).toMatchObject({ start: '0', step: '1', end: '10' })
  })

  it('emits every connected Geometry slot in stable order and rejects a known zero step', () => {
    const result = new ForResultNode({ pairId: 'pair', children: [{ id: 'first' }, { id: 'second' }, { id: 'next' }] })
    expect(result.data({
      loop: [{ pairId: 'pair', iterator: 'i', start: '0', step: '2', end: '8' }],
      'child:first': [{ code: 'cube();' }],
      'child:second': [{ code: 'sphere();' }],
    }).geometry.code).toBe('for (i = [0 : 2 : 8]) {\n  cube();\n  sphere();\n}')
    expect(() => result.data({
      loop: [{ pairId: 'pair', iterator: 'i', start: '0', step: '0.0', end: '8' }],
      'child:first': [{ code: 'cube();' }],
    })).toThrow('must not be zero')
  })

  it('treats a structurally valid result without Geometry as an omitted draft', () => {
    const result = new ForResultNode({ pairId: 'pair', children: [{ id: 'body' }] })
    expect(result.data({
      loop: [{ pairId: 'pair', iterator: 'i', start: '0', step: '1', end: '8' }],
    }).geometry).toEqual({ code: '' })
    expect(result.data({}).geometry).toMatchObject({ code: '', error: 'incomplete For pair' })
  })
})

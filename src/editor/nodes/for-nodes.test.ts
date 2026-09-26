import { describe, expect, it } from 'vitest'

import { ForHeaderNode, ForResultNode } from './for-nodes'

describe('For nodes', () => {
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
})

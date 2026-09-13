import { describe, expect, it } from 'vitest'

import { NODE_CATALOG, nodeTypeIcon } from './node-catalog'

describe('node-family icons (node-style.md "Icons in nodes and palette")', () => {
  it('gives every catalog entry a resolvable icon', () => {
    for (const entry of NODE_CATALOG) {
      expect(nodeTypeIcon(entry.type)).toBeTruthy()
    }
  })

  it('falls back to a neutral icon for an unrecognized/undefined type', () => {
    expect(nodeTypeIcon(undefined)).toBe('value')
  })

  it('keeps distinct families recognisably distinct from each other', () => {
    expect(nodeTypeIcon('cube')).not.toBe(nodeTypeIcon('translate'))
    expect(nodeTypeIcon('translate')).not.toBe(nodeTypeIcon('union'))
    expect(nodeTypeIcon('union')).not.toBe(nodeTypeIcon('number'))
    expect(nodeTypeIcon('number')).not.toBe(nodeTypeIcon('compare'))
    expect(nodeTypeIcon('compare')).not.toBe(nodeTypeIcon('conditional'))
    expect(nodeTypeIcon('conditional')).not.toBe(nodeTypeIcon('module-call'))
    expect(nodeTypeIcon('module-call')).not.toBe(nodeTypeIcon('function-call'))
    expect(nodeTypeIcon('module-inputs')).not.toBe(nodeTypeIcon('module-output'))
    expect(nodeTypeIcon('function-inputs')).not.toBe(nodeTypeIcon('function-output'))
  })

  it('shares one icon between a definition Call and its own interface family', () => {
    expect(nodeTypeIcon('module-call')).toBe('module')
    expect(nodeTypeIcon('function-call')).toBe('function')
  })
})

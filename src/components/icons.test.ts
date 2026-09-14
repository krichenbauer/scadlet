import { describe, expect, it } from 'vitest'

import { booleanOperationIconParts, compactIconPath } from './icons'

describe('compact collapse icons', () => {
  it('provides a local upward chevron path for the collapse action', () => {
    expect(compactIconPath('chevron-up')).toBe('m6 15 6-6 6 6')
  })

  it('provides a local downward chevron path for the expand action', () => {
    expect(compactIconPath('chevron-down')).toBe('m6 9 6 6 6-6')
  })

  it('uses distinct paths for expanded and collapsed states', () => {
    expect(compactIconPath('chevron-up')).not.toBe(compactIconPath('chevron-down'))
  })

  it('keeps the existing icon vocabulary available', () => {
    expect(compactIconPath('plus')).toBe('M12 5v14M5 12h14')
  })

  it('defines filled Boolean result areas and subdued operands where needed', () => {
    const partClasses = (name: 'union' | 'intersection' | 'difference') =>
      booleanOperationIconParts(name).map((part) => part.className)

    expect(partClasses('union')).toEqual([
      'boolean-operation-icon__result',
      'boolean-operation-icon__result',
    ])
    expect(partClasses('intersection')).toEqual([
      'boolean-operation-icon__input',
      'boolean-operation-icon__input',
      'boolean-operation-icon__result',
    ])
    expect(partClasses('difference')).toEqual([
      'boolean-operation-icon__input',
      'boolean-operation-icon__input',
      'boolean-operation-icon__result',
    ])
    expect(booleanOperationIconParts('union').every((part) => part.fill === '#f2f2f2')).toBe(true)
    expect(booleanOperationIconParts('intersection').slice(0, 2).every((part) => part.fill === '#8f8f8f')).toBe(true)

    expect(compactIconPath('intersection')).not.toBe(compactIconPath('difference'))
  })
})

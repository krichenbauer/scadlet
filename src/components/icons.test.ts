import { describe, expect, it } from 'vitest'

import { compactIconPath } from './icons'

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
})

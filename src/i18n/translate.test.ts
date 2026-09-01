import { describe, expect, it } from 'vitest'

import { t } from './translate'

describe('translation helper', () => {
  it('resolves the current Milestone 6 labels and accessibility descriptions', () => {
    expect(t('control.center')).toBe('Center')
    expect(t('mode.scalar')).toBe('Scalar')
    expect(t('mode.xyz')).toBe('XYZ')
    expect(t('mode.vector')).toBe('Vector')
    expect(t('input.base')).toBe('Base')
    expect(t('input.subtract')).toBe('Subtract')
    expect(t('input.geometryChild')).toBe('Geometry child')
    expect(t('input.addGeometryChild')).toBe('Add geometry child')
  })

  it('falls back to the key for a missing translation', () => {
    expect(t('missing.key')).toBe('missing.key')
  })
})

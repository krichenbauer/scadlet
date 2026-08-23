import { describe, expect, it } from 'vitest'

import { isRedundantTypeLabel } from './ports'

describe('isRedundantTypeLabel', () => {
  it('is redundant when the label just restates the socket type name', () => {
    expect(isRedundantTypeLabel('Geometry', 'geometry')).toBe(true)
  })

  it('is case-insensitive and ignores surrounding whitespace', () => {
    expect(isRedundantTypeLabel(' GEOMETRY ', 'geometry')).toBe(true)
  })

  it('is redundant when there is no label at all', () => {
    expect(isRedundantTypeLabel(undefined, 'geometry')).toBe(true)
  })

  it('is not redundant for a distinguishing label like "Base"', () => {
    expect(isRedundantTypeLabel('Base', 'geometry')).toBe(false)
  })

  it('is not redundant for a distinguishing label like "Subtract"', () => {
    expect(isRedundantTypeLabel('Subtract', 'geometry')).toBe(false)
  })
})

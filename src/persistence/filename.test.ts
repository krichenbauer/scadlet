import { describe, expect, it } from 'vitest'

import { sanitizeFilename, toScadletFilename } from './filename'

describe('sanitizeFilename', () => {
  it('trims surrounding whitespace', () => {
    expect(sanitizeFilename('  Test Project  ')).toBe('Test Project')
  })

  it('collapses internal whitespace runs', () => {
    expect(sanitizeFilename('Gearbox   Experiment')).toBe('Gearbox Experiment')
  })

  it('strips characters illegal on common filesystems', () => {
    expect(sanitizeFilename('a/b\\c:d*e?f"g<h>i|j')).toBe('abcdefghij')
  })

  it('falls back to the untitled placeholder for an empty/whitespace-only name', () => {
    expect(sanitizeFilename('')).toBe('Untitled Project')
    expect(sanitizeFilename('   ')).toBe('Untitled Project')
  })

  it('falls back to the untitled placeholder when only illegal characters remain', () => {
    expect(sanitizeFilename('***')).toBe('Untitled Project')
  })
})

describe('toScadletFilename', () => {
  it('appends the .scadlet extension', () => {
    expect(toScadletFilename('Gearbox Experiment')).toBe('Gearbox Experiment.scadlet')
  })

  it('does not duplicate an existing .scadlet extension', () => {
    expect(toScadletFilename('foo.scadlet')).toBe('foo.scadlet')
  })

  it('does not duplicate an existing extension regardless of case', () => {
    expect(toScadletFilename('foo.SCADLET')).toBe('foo.SCADLET')
  })

  it('sanitizes before appending the extension', () => {
    expect(toScadletFilename('  Test Project  ')).toBe('Test Project.scadlet')
  })

  it('uses the untitled placeholder filename for an empty name', () => {
    expect(toScadletFilename('')).toBe('Untitled Project.scadlet')
  })
})

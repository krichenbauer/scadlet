import { describe, expect, it } from 'vitest'

import { isSuccessfulEmptyTopLevelResult } from './empty-top-level'

describe('isSuccessfulEmptyTopLevelResult', () => {
  it('accepts only the bundled runtime’s known successful empty-top-level diagnostics', () => {
    expect(isSuccessfulEmptyTopLevelResult([
      "Could not initialize localization (application path is '/').",
      'Current top level object is empty.',
    ])).toBe(true)
  })

  it('does not turn an arbitrary sparse diagnostic into a successful empty render', () => {
    expect(isSuccessfulEmptyTopLevelResult([])).toBe(false)
    expect(isSuccessfulEmptyTopLevelResult(['Current top level object is empty.', 'ERROR: Parser error.'])).toBe(false)
    expect(isSuccessfulEmptyTopLevelResult(['ERROR: Parser error.'])).toBe(false)
  })
})

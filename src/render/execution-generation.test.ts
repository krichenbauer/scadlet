import { describe, expect, it } from 'vitest'

import { ExecutionGeneration } from './execution-generation'

describe('ExecutionGeneration', () => {
  it('keeps only the latest explicit action current', () => {
    const generation = new ExecutionGeneration()
    const first = generation.begin()
    const second = generation.begin()

    expect(generation.isCurrent(first)).toBe(false)
    expect(generation.isCurrent(second)).toBe(true)
  })

  it('invalidates an in-flight action without starting another one', () => {
    const generation = new ExecutionGeneration()
    const inspect = generation.begin()
    generation.invalidate()

    expect(generation.isCurrent(inspect)).toBe(false)
  })
})

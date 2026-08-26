import { describe, expect, it } from 'vitest'

import { shouldAccumulateOnPick, shouldToggleOffOnPick } from './selection'

describe('shouldAccumulateOnPick', () => {
  it('accumulates when Ctrl/Cmd is held, regardless of prior selection', () => {
    expect(shouldAccumulateOnPick(true, false)).toBe(true)
    expect(shouldAccumulateOnPick(true, true)).toBe(true)
  })

  it('accumulates when the picked node is already selected, even without a modifier (preserves a multi-selection when a group drag starts)', () => {
    expect(shouldAccumulateOnPick(false, true)).toBe(true)
  })

  it('does not accumulate for a plain click on a node that is not already selected', () => {
    expect(shouldAccumulateOnPick(false, false)).toBe(false)
  })
})

describe('shouldToggleOffOnPick', () => {
  it('toggles off only when Ctrl/Cmd is held AND the node was already selected', () => {
    expect(shouldToggleOffOnPick(true, true)).toBe(true)
  })

  it('does not toggle off without a modifier', () => {
    expect(shouldToggleOffOnPick(false, true)).toBe(false)
  })

  it('does not toggle off a node that was not already selected', () => {
    expect(shouldToggleOffOnPick(true, false)).toBe(false)
  })
})

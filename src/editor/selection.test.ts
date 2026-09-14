import { describe, expect, it } from 'vitest'

import { shouldAccumulateOnPick, shouldToggleOffAfterPick } from './selection'

describe('shouldAccumulateOnPick', () => {
  it('accumulates when Shift/Ctrl/Cmd is held, regardless of prior selection', () => {
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

describe('shouldToggleOffAfterPick', () => {
  it('toggles off only when a modifier is held, the node was already selected, and the gesture stayed a click', () => {
    expect(shouldToggleOffAfterPick(true, true, false)).toBe(true)
  })

  it('does not toggle off without a modifier', () => {
    expect(shouldToggleOffAfterPick(false, true, false)).toBe(false)
  })

  it('does not toggle off a node that was not already selected', () => {
    expect(shouldToggleOffAfterPick(true, false, false)).toBe(false)
  })

  it('does not toggle off when the pointer gesture became a drag', () => {
    expect(shouldToggleOffAfterPick(true, true, true)).toBe(false)
  })
})

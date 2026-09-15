import { describe, expect, it, vi } from 'vitest'

import { dismissTransientPopupsOutside, transientPopupContainsPath, type TransientPopupEntry } from './transient-popups'

describe('transient popup dismissal boundary', () => {
  const entry = (): TransientPopupEntry => ({ popup: new EventTarget(), trigger: new EventTarget(), dismiss: vi.fn() })

  it('keeps interactions inside the popup and on its trigger', () => {
    const popup = entry()
    expect(transientPopupContainsPath(popup, [new EventTarget(), popup.popup])).toBe(true)
    expect(transientPopupContainsPath(popup, [popup.trigger])).toBe(true)
  })

  it('classifies canvas, node, socket, and viewer targets as outside', () => {
    const popup = entry()
    for (const outside of [new EventTarget(), new EventTarget(), new EventTarget(), new EventTarget()]) {
      expect(transientPopupContainsPath(popup, [outside])).toBe(false)
    }
  })

  it('treats a nested submenu as inside its parent but outside an unrelated menu', () => {
    const parent = entry()
    const nested = entry()
    const unrelated = entry()
    const path = [nested.popup, parent.popup]
    expect(transientPopupContainsPath(parent, path)).toBe(true)
    expect(transientPopupContainsPath(nested, path)).toBe(true)
    expect(transientPopupContainsPath(unrelated, path)).toBe(false)
    dismissTransientPopupsOutside([parent, nested, unrelated], path)
    expect(parent.dismiss).not.toHaveBeenCalled()
    expect(nested.dismiss).not.toHaveBeenCalled()
    expect(unrelated.dismiss).toHaveBeenCalledOnce()
  })
})

import { describe, expect, it, vi } from 'vitest'

import { ConnectionSelectionManager } from './connection-selection'

describe('ConnectionSelectionManager', () => {
  it('keeps exactly one transient selected connection and reports replacement', () => {
    const selection = new ConnectionSelectionManager()
    const listener = vi.fn()
    selection.subscribe(listener)
    selection.select('first')
    selection.select('second')
    expect(selection.id).toBe('second')
    expect(listener).toHaveBeenNthCalledWith(1, null, 'first')
    expect(listener).toHaveBeenNthCalledWith(2, 'first', 'second')
  })

  it('clears when its selected connection is removed', () => {
    const selection = new ConnectionSelectionManager()
    selection.select('wire')
    selection.remove('wire')
    expect(selection.id).toBeNull()
  })
})

import { describe, expect, it } from 'vitest'

import { isDirtyAreaSignal, isDirtyEditorSignal } from './dirty'

describe('isDirtyEditorSignal', () => {
  it.each(['nodecreated', 'noderemoved', 'connectioncreated', 'connectionremoved'])(
    '%s marks the project dirty',
    (type) => {
      expect(isDirtyEditorSignal(type)).toBe(true)
    },
  )

  it.each(['nodecreate', 'noderemove', 'connectioncreate', 'connectionremove', 'clear', 'cleared', 'nodepicked', 'bogus'])(
    '%s does not mark the project dirty',
    (type) => {
      expect(isDirtyEditorSignal(type)).toBe(false)
    },
  )
})

describe('isDirtyAreaSignal', () => {
  it.each(['nodetranslated', 'translated', 'zoomed'])('%s marks the project dirty', (type) => {
    expect(isDirtyAreaSignal(type)).toBe(true)
  })

  it.each(['nodetranslate', 'translate', 'zoom', 'nodepicked', 'nodedragged', 'render', 'rendered', 'unmount', 'bogus'])(
    '%s does not mark the project dirty',
    (type) => {
      expect(isDirtyAreaSignal(type)).toBe(false)
    },
  )
})

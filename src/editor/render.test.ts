import { describe, expect, it } from 'vitest'

import { parameterRowPresentation } from './render'

const visibleKeys = (rows: ReturnType<typeof parameterRowPresentation>) =>
  rows.filter((row) => row.visible).map((row) => row.key)

describe('parameter row presentation', () => {
  const canonical = ['a', 'b', 'c']

  it('keeps compact connected rows in canonical relative order', () => {
    const rows = parameterRowPresentation(canonical, false, new Set(['c', 'a']), new Set())
    expect(rows.map((row) => row.key)).toEqual(['a', 'b', 'c'])
    expect(visibleKeys(rows)).toEqual(['a', 'c'])
  })

  it('shows every row in canonical order when expanded, regardless of connection order', () => {
    const rows = parameterRowPresentation(canonical, true, new Set(['c', 'a']), new Set())
    expect(visibleKeys(rows)).toEqual(['a', 'b', 'c'])
  })

  it('keeps a single connected compact row visible without reordering the canonical sequence', () => {
    const rows = parameterRowPresentation(canonical, false, new Set(['b']), new Set())
    expect(rows.map((row) => row.key)).toEqual(['a', 'b', 'c'])
    expect(visibleKeys(rows)).toEqual(['b'])
  })

  it('uses the same canonical order for Phase 1 connection disclosure', () => {
    const rows = parameterRowPresentation(canonical, false, new Set(['c']), new Set(['a', 'b', 'c']))
    expect(visibleKeys(rows)).toEqual(['a', 'b', 'c'])
  })
})

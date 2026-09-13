import { describe, expect, it } from 'vitest'

import { parameterRowPresentation } from './render'

const visibleKeys = (rows: ReturnType<typeof parameterRowPresentation>) =>
  rows.filter((row) => row.visible).map((row) => row.key)

describe('parameter row presentation', () => {
  const canonical = ['a', 'b', 'c']

  it('hides every unconnected row while explicitly collapsed', () => {
    const rows = parameterRowPresentation(canonical, false, new Set())
    expect(visibleKeys(rows)).toEqual([])
  })

  it('keeps compact connected rows in canonical relative order', () => {
    const rows = parameterRowPresentation(canonical, false, new Set(['c', 'a']))
    expect(rows.map((row) => row.key)).toEqual(['a', 'b', 'c'])
    expect(visibleKeys(rows)).toEqual(['a', 'c'])
  })

  it('shows every row in canonical order when expanded, regardless of connection order', () => {
    const rows = parameterRowPresentation(canonical, true, new Set(['c', 'a']))
    expect(visibleKeys(rows)).toEqual(['a', 'b', 'c'])
  })

  it('keeps a single connected compact row visible without reordering the canonical sequence', () => {
    const rows = parameterRowPresentation(canonical, false, new Set(['b']))
    expect(rows.map((row) => row.key)).toEqual(['a', 'b', 'c'])
    expect(visibleKeys(rows)).toEqual(['b'])
  })

  it('marks only actually connected rows as connected', () => {
    const rows = parameterRowPresentation(canonical, false, new Set(['b']))
    expect(rows.map(({ key, connected }) => ({ key, connected }))).toEqual([
      { key: 'a', connected: false },
      { key: 'b', connected: true },
      { key: 'c', connected: false },
    ])
  })

  it('ignores keys outside the node-defined canonical input list', () => {
    const rows = parameterRowPresentation(canonical, false, new Set(['missing']))
    expect(rows.map((row) => row.key)).toEqual(canonical)
    expect(visibleKeys(rows)).toEqual([])
  })

  it('supports a node with no parameter rows', () => {
    expect(parameterRowPresentation([], true, new Set())).toEqual([])
  })
})

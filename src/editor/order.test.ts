import { describe, expect, it, vi } from 'vitest'

import { bringNodeToFront, type NodeOrderArea } from './order'

function createArea(entries: [string, { element: HTMLElement }][]): {
  area: NodeOrderArea
  reorder: ReturnType<typeof vi.fn>
} {
  const reorder = vi.fn()
  const area: NodeOrderArea = {
    nodeViews: new Map(entries),
    area: { content: { reorder } },
  }
  return { area, reorder }
}

describe('bringNodeToFront', () => {
  it('reorders the node view element to the end of its siblings', () => {
    const element = {} as HTMLElement
    const { area, reorder } = createArea([['node-1', { element }]])

    bringNodeToFront(area, 'node-1')

    expect(reorder).toHaveBeenCalledWith(element, null)
    expect(reorder).toHaveBeenCalledTimes(1)
  })

  it('is a no-op for an unknown node id', () => {
    const { area, reorder } = createArea([])

    bringNodeToFront(area, 'missing')

    expect(reorder).not.toHaveBeenCalled()
  })

  it('only reorders the requested node, not other nodes on the canvas', () => {
    const wanted = { id: 'wanted' } as unknown as HTMLElement
    const other = { id: 'other' } as unknown as HTMLElement
    const { area, reorder } = createArea([
      ['other', { element: other }],
      ['wanted', { element: wanted }],
    ])

    bringNodeToFront(area, 'wanted')

    expect(reorder).toHaveBeenCalledWith(wanted, null)
    expect(reorder).not.toHaveBeenCalledWith(other, null)
  })

  it('is a no-op when the element is already the last sibling (already frontmost)', () => {
    // Regression test: an unconditional reorder here, even when nothing
    // would actually move, previously caused an infinite `pointerenter`
    // storm in the browser (moving a node under the pointer re-triggers
    // hit-testing), which permanently reset the hover-expand timer - see
    // `bringNodeToFront`'s doc comment.
    const element = {} as unknown as HTMLElement
    const parent = { lastElementChild: element } as unknown as HTMLElement
    Object.defineProperty(element, 'parentElement', { value: parent })
    const { area, reorder } = createArea([['node-1', { element }]])

    bringNodeToFront(area, 'node-1')

    expect(reorder).not.toHaveBeenCalled()
  })
})

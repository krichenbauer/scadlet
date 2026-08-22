import { describe, expect, it } from 'vitest'

import { scadBlob, stlBlob } from './download'

describe('scadBlob', () => {
  it('wraps the source string with an OpenSCAD MIME type', async () => {
    const blob = scadBlob('cube([1,1,1]);')
    expect(blob.type).toBe('application/x-openscad')
    expect(await blob.text()).toBe('cube([1,1,1]);')
  })
})

describe('stlBlob', () => {
  it('wraps STL bytes with a model/stl MIME type', async () => {
    const bytes = new Uint8Array([1, 2, 3, 4])
    const blob = stlBlob(bytes.buffer)
    expect(blob.type).toBe('model/stl')
    expect(blob.size).toBe(4)
  })
})

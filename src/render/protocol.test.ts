import { describe, expect, it } from 'vitest'

import { isRenderResponse } from './protocol'

describe('isRenderResponse', () => {
  it('accepts a well-formed result message', () => {
    expect(isRenderResponse({ type: 'result', stl: new ArrayBuffer(4) })).toBe(true)
  })

  it('accepts a well-formed error message', () => {
    expect(isRenderResponse({ type: 'error', message: 'boom' })).toBe(true)
  })

  it('rejects a result message with a non-ArrayBuffer stl field', () => {
    expect(isRenderResponse({ type: 'result', stl: 'not-a-buffer' })).toBe(false)
  })

  it('rejects a result message missing the stl field', () => {
    expect(isRenderResponse({ type: 'result' })).toBe(false)
  })

  it('rejects an error message with a non-string message field', () => {
    expect(isRenderResponse({ type: 'error', message: 42 })).toBe(false)
  })

  it('rejects an unknown message type', () => {
    expect(isRenderResponse({ type: 'progress' })).toBe(false)
  })

  it('rejects non-object values', () => {
    expect(isRenderResponse(null)).toBe(false)
    expect(isRenderResponse(undefined)).toBe(false)
    expect(isRenderResponse('result')).toBe(false)
    expect(isRenderResponse(42)).toBe(false)
  })
})

/**
 * Message shapes exchanged between the main thread and the OpenSCAD
 * render worker (`render-worker.ts`). Kept intentionally small and
 * explicit per Milestone 2 scope.
 */

export interface RenderRequest {
  type: 'render'
  source: string
}

export interface RenderResultMessage {
  type: 'result'
  stl: ArrayBuffer
}

export interface RenderErrorMessage {
  type: 'error'
  message: string
}

export type RenderResponse = RenderResultMessage | RenderErrorMessage

/**
 * Runtime guard for messages received from the worker. Worker `message`
 * events are untyped at the platform level, so anything unexpected
 * (e.g. a malformed payload) should be rejected rather than trusted.
 */
export function isRenderResponse(value: unknown): value is RenderResponse {
  if (typeof value !== 'object' || value === null || !('type' in value)) return false

  const type = (value as { type: unknown }).type
  if (type === 'result') {
    return 'stl' in value && (value as { stl: unknown }).stl instanceof ArrayBuffer
  }
  if (type === 'error') {
    return typeof (value as { message?: unknown }).message === 'string'
  }
  return false
}

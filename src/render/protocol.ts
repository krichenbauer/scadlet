/**
 * Message shapes exchanged between the main thread and the OpenSCAD
 * render worker (`render-worker.ts`). Kept intentionally small and
 * explicit per Milestone 2 scope.
 */

export interface RenderRequest {
  type: 'render'
  source: string
}

export interface InspectValueRequest {
  type: 'inspect-value'
  source: string
}

export type WorkerRequest = RenderRequest | InspectValueRequest

export interface RenderResultMessage {
  type: 'result'
  stl: ArrayBuffer
}

/** A valid OpenSCAD execution whose top-level Geometry is empty. */
export interface EmptyRenderResultMessage {
  type: 'empty-result'
}

export interface RenderErrorMessage {
  type: 'error'
  message: string
}

export interface InspectValueResultMessage {
  type: 'value-result'
  value: string
}

export type RenderResponse = RenderResultMessage | EmptyRenderResultMessage | InspectValueResultMessage | RenderErrorMessage

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
  if (type === 'empty-result') return true
  if (type === 'error') {
    return typeof (value as { message?: unknown }).message === 'string'
  }
  if (type === 'value-result') return typeof (value as { value?: unknown }).value === 'string'
  return false
}

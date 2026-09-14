/** Options passed to OpenSCAD which can affect generated preview bytes. Keep
 * this object shared by the worker request and preview-cache key. */
export interface GeometryRenderOptions {
  backend: 'Manifold'
  exportFormat: 'binstl'
}

export const GEOMETRY_RENDER_OPTIONS: GeometryRenderOptions = Object.freeze({
  backend: 'Manifold',
  exportFormat: 'binstl',
})


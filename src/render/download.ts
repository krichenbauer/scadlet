/** Builds the Blob for a `.scad` download from generated OpenSCAD source. */
export function scadBlob(source: string): Blob {
  return new Blob([source], { type: 'application/x-openscad' })
}

/** Builds the Blob for a `.stl` download from the bytes returned by the render worker. */
export function stlBlob(stl: ArrayBuffer): Blob {
  return new Blob([stl], { type: 'model/stl' })
}

/**
 * Triggers a client-side file download for `blob` with no server
 * involvement, using the standard Blob/Object URL + anchor-click
 * approach.
 */
export function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  // Revoke on a later tick so the click's navigation has a chance to start.
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

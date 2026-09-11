/**
 * The bundled OpenSCAD-WASM build reports a valid empty top-level object by
 * returning from `callMain()` without writing the requested STL. Its only
 * meaningful diagnostic is this exact line; it is not an OpenSCAD error.
 *
 * Keep this deliberately narrow. In particular, a missing output file by
 * itself is still a render failure, as is any diagnostic set other than this
 * known successful outcome (plus the bundled runtime's fixed startup notice).
 */
const EMPTY_TOP_LEVEL_DIAGNOSTIC = 'Current top level object is empty.'
const LOCALIZATION_STARTUP_DIAGNOSTIC = "Could not initialize localization (application path is '/')."

export function isSuccessfulEmptyTopLevelResult(diagnostics: readonly string[]): boolean {
  const meaningfulDiagnostics = diagnostics
    .map((diagnostic) => diagnostic.trim())
    .filter((diagnostic) => diagnostic.length > 0 && diagnostic !== LOCALIZATION_STARTUP_DIAGNOSTIC)

  return meaningfulDiagnostics.length === 1 && meaningfulDiagnostics[0] === EMPTY_TOP_LEVEL_DIAGNOSTIC
}

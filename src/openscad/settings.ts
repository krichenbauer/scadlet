import { formatNumber } from './format'
import { requireFiniteNumber, requireParamsObject } from './param-validation'

/** The deliberately closed set of scope-level OpenSCAD quality controls. */
export type ScadSettingKind = 'fn' | 'fa' | 'fs'

export interface ScadSettingsParams {
  fn?: number
  fa?: number
  fs?: number
}

export const SCAD_SETTING_KINDS: readonly ScadSettingKind[] = ['fn', 'fa', 'fs']

export function validateScadSettingsParams(value: unknown): ScadSettingsParams {
  const obj = requireParamsObject(value, 'SCAD settings parameters')
  const result: ScadSettingsParams = {}
  for (const kind of SCAD_SETTING_KINDS) {
    if (obj[kind] !== undefined) result[kind] = requireFiniteNumber(obj[kind], `SCAD setting "$${kind}"`)
  }
  return result
}

/** Assignments are statements because OpenSCAD special variables configure
 * every later expression/geometry statement in their current lexical scope. */
export function scadSettingsToOpenSCAD(
  params: ScadSettingsParams,
  expressions: Partial<Record<ScadSettingKind, string>> = {},
): string {
  return SCAD_SETTING_KINDS
    .filter((kind) => params[kind] !== undefined)
    .map((kind) => `$${kind} = ${expressions[kind] ?? formatNumber(params[kind]!)};`)
    .join('\n')
}

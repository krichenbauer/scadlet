import { ClassicPreset } from 'rete'
import type { DataflowNode } from 'rete-engine'

import { t } from '../../i18n/translate'
import { SCAD_SETTING_KINDS, scadSettingsToOpenSCAD, type ScadSettingKind, type ScadSettingsParams } from '../../openscad/settings'
import { LabeledNumberControl, ParameterActionsControl, type ParameterAction, type RemovableRow } from '../controls'
import { numberSocket, type NumberValue } from '../sockets'

export interface ScadSettingsValue { code: string }

type ScadSettingsControls = Record<string, ClassicPreset.Control> & {
  actions: ParameterActionsControl
}

const DEFAULTS: Readonly<Record<ScadSettingKind, number>> = { fn: 30, fa: 12, fs: 2 }

function settingLabel(kind: ScadSettingKind): string {
  return t(`settings.${kind}`)
}

/** One scope-level configuration node. Its Number inputs are normal Rete
 * dataflow dependencies, while the evaluator deliberately roots the node
 * once per supported scope because it has no Geometry output by design. */
export class ScadSettingsNode
  extends ClassicPreset.Node<Record<string, ClassicPreset.Socket>, Record<string, never>, ScadSettingsControls>
  implements DataflowNode
{
  private readonly notify?: () => void
  private readonly requestRemoveForm?: (keys: readonly string[], label: string) => Promise<boolean>
  private values: ScadSettingsParams

  constructor(
    params: ScadSettingsParams = {},
    notify?: () => void,
    requestRemoveForm?: (keys: readonly string[], label: string) => Promise<boolean>,
  ) {
    super(t('node.scadSettings'))
    this.notify = notify
    this.requestRemoveForm = requestRemoveForm
    this.values = { ...params }
    for (const kind of SCAD_SETTING_KINDS) {
      const value = params[kind]
      if (value !== undefined) this.addSetting(kind, value)
    }
    this.addControl('actions', new ParameterActionsControl(() => this.actions()))
  }

  private addSetting(kind: ScadSettingKind, value: number): void {
    this.values[kind] = value
    const label = settingLabel(kind)
    this.addInput(kind, new ClassicPreset.Input(numberSocket, label))
    this.addControl(kind, new LabeledNumberControl(label, {
      initial: value,
      change: (next) => { this.values[kind] = next },
    }))
  }

  private actions(): readonly ParameterAction[] {
    return SCAD_SETTING_KINDS
      .filter((kind) => this.values[kind] === undefined)
      .map((kind) => ({
        id: `add-${kind}`,
        label: settingLabel(kind),
        run: () => { this.addSetting(kind, DEFAULTS[kind]); this.notify?.() },
      }))
  }

  removableRows(): readonly RemovableRow[] {
    return SCAD_SETTING_KINDS
      .filter((kind) => this.values[kind] !== undefined)
      .map((kind) => ({ key: kind, label: settingLabel(kind), requestRemove: () => this.removeSetting(kind) }))
  }

  private async removeSetting(kind: ScadSettingKind): Promise<boolean> {
    const label = settingLabel(kind)
    if (!(await (this.requestRemoveForm?.([kind], label) ?? Promise.resolve(true)))) return false
    if (this.controls[kind]) this.removeControl(kind)
    if (this.inputs[kind]) this.removeInput(kind)
    delete this.values[kind]
    this.notify?.()
    return true
  }

  getPersistedParams(): ScadSettingsParams {
    const result: ScadSettingsParams = { ...this.values }
    for (const kind of SCAD_SETTING_KINDS) {
      const control = this.controls[kind]
      if (control instanceof LabeledNumberControl) result[kind] = control.value ?? this.values[kind]
    }
    return result
  }

  data(inputs: Record<string, NumberValue[] | undefined>): { settings: ScadSettingsValue } {
    const params = this.getPersistedParams()
    const expressions: Partial<Record<ScadSettingKind, string>> = {}
    for (const kind of SCAD_SETTING_KINDS) {
      const expression = inputs[kind]?.[0]?.code
      if (expression !== undefined) expressions[kind] = expression
    }
    return { settings: { code: scadSettingsToOpenSCAD(params, expressions) } }
  }
}

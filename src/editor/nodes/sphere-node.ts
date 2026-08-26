import { ClassicPreset } from 'rete'
import type { DataflowNode } from 'rete-engine'

import { t } from '../../i18n/translate'
import {
  DEFAULT_SPHERE_PARAMS,
  sphereToOpenSCAD,
  type SphereParams,
  type SphereSizeMode,
} from '../../openscad/sphere'
import { CheckboxControl, LabeledNumberControl, SelectControl } from '../controls'
import { geometrySocket, type GeometryValue } from '../sockets'

type SphereControls = {
  mode: SelectControl<SphereSizeMode>
  r?: LabeledNumberControl
  d?: LabeledNumberControl
  fnEnabled: CheckboxControl
  fn?: LabeledNumberControl
}

function modeOptions(): { value: SphereSizeMode; label: string }[] {
  return [
    { value: 'radius', label: t('mode.radius') },
    { value: 'diameter', label: t('mode.diameter') },
  ]
}

/**
 * The `sphere()` primitive. Reuses Cylinder's radius/diameter
 * progressive-disclosure pattern (a `SelectControl` mode switch that
 * adds/removes the relevant control, plus an "enable" checkbox gating an
 * optional `$fn`) - `sphere()` has no `center` parameter (it's always
 * centered at the origin in OpenSCAD) and no tapered form, so this is
 * simpler than `CylinderNode` rather than sharing code with it.
 */
export class SphereNode
  extends ClassicPreset.Node<Record<string, never>, { geometry: ClassicPreset.Socket }, SphereControls>
  implements DataflowNode
{
  private r: number
  private d: number
  private fnValue: number

  constructor(params: Partial<SphereParams> = {}, notify?: () => void) {
    super('Sphere')

    const merged = { ...DEFAULT_SPHERE_PARAMS, ...params }
    this.r = merged.r
    this.d = merged.d
    this.fnValue = merged.fn ?? 30

    const mode = new SelectControl<SphereSizeMode>(t('control.size'), modeOptions(), merged.mode)
    mode.onChange = () => {
      this.updateSizeControls()
      notify?.()
    }
    this.addControl('mode', mode)
    this.updateSizeControls()

    const fnEnabled = new CheckboxControl(t('control.enableFn'), merged.fn !== undefined)
    fnEnabled.onChange = () => {
      this.updateFnControl()
      notify?.()
    }
    this.addControl('fnEnabled', fnEnabled)
    this.updateFnControl()

    this.addOutput('geometry', new ClassicPreset.Output(geometrySocket, 'Geometry'))
  }

  private updateSizeControls(): void {
    for (const key of ['r', 'd'] as const) {
      if (this.controls[key]) this.removeControl(key)
    }

    if (this.controls.mode.value === 'radius') {
      this.addControl(
        'r',
        new LabeledNumberControl(t('control.radius'), { initial: this.r, change: (v) => (this.r = v) }),
      )
    } else {
      this.addControl(
        'd',
        new LabeledNumberControl(t('control.diameter'), { initial: this.d, change: (v) => (this.d = v) }),
      )
    }
  }

  private updateFnControl(): void {
    if (this.controls.fn) this.removeControl('fn')
    if (this.controls.fnEnabled.value) {
      this.addControl(
        'fn',
        new LabeledNumberControl(t('control.fn'), { initial: this.fnValue, change: (v) => (this.fnValue = v) }),
      )
    }
  }

  data(): { geometry: GeometryValue } {
    const params: SphereParams = {
      mode: this.controls.mode.value,
      r: this.r,
      d: this.d,
      fn: this.controls.fnEnabled.value ? this.fnValue : undefined,
    }
    return { geometry: { code: sphereToOpenSCAD(params) } }
  }
}

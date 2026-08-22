import { ClassicPreset } from 'rete'
import type { DataflowNode } from 'rete-engine'

import {
  cylinderToOpenSCAD,
  DEFAULT_CYLINDER_PARAMS,
  type CylinderParams,
  type CylinderSizeMode,
} from '../../openscad/cylinder'
import { CheckboxControl, LabeledNumberControl, SelectControl } from '../controls'
import { geometrySocket, type GeometryValue } from '../sockets'

type CylinderControls = {
  h: LabeledNumberControl
  mode: SelectControl<CylinderSizeMode>
  r?: LabeledNumberControl
  d?: LabeledNumberControl
  r1?: LabeledNumberControl
  r2?: LabeledNumberControl
  center: CheckboxControl
  fnEnabled: CheckboxControl
  fn?: LabeledNumberControl
}

const MODE_OPTIONS: { value: CylinderSizeMode; label: string }[] = [
  { value: 'radius', label: 'Radius' },
  { value: 'diameter', label: 'Diameter' },
  { value: 'tapered', label: 'Tapered' },
]

/**
 * The `cylinder()` primitive. Radius/diameter/tapered sizing are mutually
 * exclusive OpenSCAD forms, so - per AGENTS.md's progressive-disclosure
 * guidance - only the control(s) for the currently selected `mode` exist
 * on the node at all; switching modes adds/removes controls rather than
 * showing all of them at once. The same technique hides the optional
 * `$fn` field behind an "enable" checkbox. `notify` lets the owner (see
 * `editor.ts`) re-render the node when its visible control set changes.
 */
export class CylinderNode
  extends ClassicPreset.Node<Record<string, never>, { geometry: ClassicPreset.Socket }, CylinderControls>
  implements DataflowNode
{
  private r: number
  private d: number
  private r1: number
  private r2: number
  private fnValue: number

  constructor(params: Partial<CylinderParams> = {}, notify?: () => void) {
    super('Cylinder')

    const merged = { ...DEFAULT_CYLINDER_PARAMS, ...params }
    this.r = merged.r
    this.d = merged.d
    this.r1 = merged.r1
    this.r2 = merged.r2
    this.fnValue = merged.fn ?? 30

    this.addControl('h', new LabeledNumberControl('H', { initial: merged.h }))

    const mode = new SelectControl<CylinderSizeMode>('Size', MODE_OPTIONS, merged.mode)
    mode.onChange = () => {
      this.updateSizeControls()
      notify?.()
    }
    this.addControl('mode', mode)
    this.updateSizeControls()

    this.addControl('center', new CheckboxControl('Center', merged.center))

    const fnEnabled = new CheckboxControl('Enable $fn', merged.fn !== undefined)
    fnEnabled.onChange = () => {
      this.updateFnControl()
      notify?.()
    }
    this.addControl('fnEnabled', fnEnabled)
    this.updateFnControl()

    this.addOutput('geometry', new ClassicPreset.Output(geometrySocket, 'Geometry'))
  }

  private updateSizeControls(): void {
    for (const key of ['r', 'd', 'r1', 'r2'] as const) {
      if (this.controls[key]) this.removeControl(key)
    }

    const mode = this.controls.mode.value
    if (mode === 'radius') {
      this.addControl('r', new LabeledNumberControl('R', { initial: this.r, change: (v) => (this.r = v) }))
    } else if (mode === 'diameter') {
      this.addControl('d', new LabeledNumberControl('D', { initial: this.d, change: (v) => (this.d = v) }))
    } else {
      this.addControl(
        'r1',
        new LabeledNumberControl('R1', { initial: this.r1, change: (v) => (this.r1 = v) }),
      )
      this.addControl(
        'r2',
        new LabeledNumberControl('R2', { initial: this.r2, change: (v) => (this.r2 = v) }),
      )
    }
  }

  private updateFnControl(): void {
    if (this.controls.fn) this.removeControl('fn')
    if (this.controls.fnEnabled.value) {
      this.addControl(
        'fn',
        new LabeledNumberControl('$fn', { initial: this.fnValue, change: (v) => (this.fnValue = v) }),
      )
    }
  }

  data(): { geometry: GeometryValue } {
    const params: CylinderParams = {
      h: this.controls.h.value ?? DEFAULT_CYLINDER_PARAMS.h,
      mode: this.controls.mode.value,
      r: this.r,
      d: this.d,
      r1: this.r1,
      r2: this.r2,
      center: this.controls.center.value,
      fn: this.controls.fnEnabled.value ? this.fnValue : undefined,
    }
    return { geometry: { code: cylinderToOpenSCAD(params) } }
  }
}

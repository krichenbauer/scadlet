import { ClassicPreset } from 'rete'

/**
 * A `ClassicPreset.InputControl<'number'>` with a short UI label, since
 * the base control has no label of its own. Reusable by any node that
 * needs a labeled numeric field (e.g. per-axis size, angle, distance).
 */
export class LabeledNumberControl extends ClassicPreset.InputControl<'number'> {
  readonly label: string

  constructor(
    label: string,
    options?: { initial?: number; readonly?: boolean; change?: (value: number) => void },
  ) {
    super('number', options)
    this.label = label
  }
}

/**
 * A simple boolean control for OpenSCAD flags such as `center`. Rete's
 * `ClassicPreset` has no built-in checkbox control, so this is a minimal
 * one, reusable by any future node with a boolean parameter.
 */
export class CheckboxControl extends ClassicPreset.Control {
  readonly label: string
  value: boolean

  constructor(label: string, initial = false) {
    super()
    this.label = label
    this.value = initial
  }

  setValue(value: boolean): void {
    this.value = value
  }
}

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
  /** Called after `value` changes; used by nodes that need to react structurally (e.g. show/hide other controls). */
  onChange?: (value: boolean) => void

  constructor(label: string, initial = false) {
    super()
    this.label = label
    this.value = initial
  }

  setValue(value: boolean): void {
    this.value = value
    this.onChange?.(value)
  }
}

/**
 * A labeled dropdown for choosing between a fixed set of mutually
 * exclusive modes (e.g. a cylinder's radius/diameter/tapered sizing).
 * Reusable by any future node with a small, fixed set of named modes -
 * deliberately not a generic "options" framework beyond that.
 */
export class SelectControl<T extends string = string> extends ClassicPreset.Control {
  readonly label: string
  readonly options: readonly { value: T; label: string }[]
  value: T
  /** Called after `value` changes; used by nodes that need to react structurally (e.g. show/hide other controls). */
  onChange?: (value: T) => void

  constructor(label: string, options: readonly { value: T; label: string }[], initial: T) {
    super()
    this.label = label
    this.options = options
    this.value = initial
  }

  setValue(value: T): void {
    this.value = value
    this.onChange?.(value)
  }
}

/** A deliberately small progressive-disclosure affordance. Nodes own their
 * semantic choices; this control only renders the available add/remove
 * actions and avoids a generic parameter-schema framework. */
export class ParameterActionsControl extends ClassicPreset.Control {
  readonly actions: () => readonly { id: string; label: string; run: () => void }[]

  constructor(actions: () => readonly { id: string; label: string; run: () => void }[]) {
    super()
    this.actions = actions
  }
}

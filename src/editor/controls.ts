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

/** A small named text control for descriptive project content such as a
 * source-value label. It is deliberately not an OpenSCAD identifier. */
export class LabeledTextControl extends ClassicPreset.InputControl<'text'> {
  readonly label: string

  constructor(label: string, options?: { initial?: string; change?: (value: string) => void }) {
    super('text', options)
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

/** The existing three-number literal convention, packaged as one semantic
 * Vector3 fallback for a Module Call parameter. */
export class Vector3Control extends ClassicPreset.Control {
  readonly label: string
  value: [number, number, number]

  constructor(label: string, initial: [number, number, number]) {
    super()
    this.label = label
    this.value = [...initial] as [number, number, number]
  }

  setValue(value: [number, number, number]): void { this.value = [...value] as [number, number, number] }
}

/** Compact inline creation state for the permanent Module Inputs node. It is
 * intentionally only an add form; signature mutation UI belongs to Phase 4. */
export class ModuleParameterAddControl extends ClassicPreset.Control {
  open = false
  name = ''
  type: 'number' | 'boolean' | 'vector3' = 'number'
  defaultNumber = 0
  defaultBoolean = false
  defaultVector: [number, number, number] = [0, 0, 0]
  error: string | null = null
  onChange: () => void
  onSubmit: (value: { name: string; type: 'number' | 'boolean' | 'vector3'; default: number | boolean | [number, number, number] }) => boolean | void | Promise<boolean | void>
  constructor(onChange: () => void, onSubmit: (value: { name: string; type: 'number' | 'boolean' | 'vector3'; default: number | boolean | [number, number, number] }) => boolean | void | Promise<boolean | void>) { super(); this.onChange = onChange; this.onSubmit = onSubmit }
  show(): void { this.open = true; this.error = null; this.onChange() }
  hide(): void { this.open = false; this.onChange() }
}

export class ModuleParameterEditControl extends ModuleParameterAddControl {
  parameterId: string | null = null
  order = 0
  /** `true` means the destructive edit completed. `false` keeps this form
   * open, which is how a user-cancelled confirmation remains editable. */
  onDelete: (id: string) => boolean | Promise<boolean> = () => false
  onMove: (id: string, direction: -1 | 1) => void | Promise<void> = () => {}
  openParameter(parameter: { id: string; name: string; type: 'number' | 'boolean' | 'vector3'; default: number | boolean | [number, number, number] }, order: number): void {
    this.parameterId = parameter.id; this.name = parameter.name; this.type = parameter.type; this.order = order; this.error = null; this.open = true
    if (parameter.type === 'number') this.defaultNumber = parameter.default as number
    else if (parameter.type === 'boolean') this.defaultBoolean = parameter.default as boolean
    else this.defaultVector = [...parameter.default as [number, number, number]] as [number, number, number]
    this.onChange()
  }
  override hide(): void { this.parameterId = null; super.hide() }
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
  /** Returns false when changing away from the current option would hide a
   * connected semantic port. Kept on the control so renderer feedback and
   * the low-level node callback share one rule. */
  canChange?: (value: T) => boolean

  constructor(label: string, options: readonly { value: T; label: string }[], initial: T) {
    super()
    this.label = label
    this.options = options
    this.value = initial
  }

  setValue(value: T): void {
    if (value !== this.value && this.canChange && !this.canChange(value)) return
    this.value = value
    this.onChange?.(value)
  }
}

/** A select that belongs to one semantic parameter rather than the node as
 * a whole. The renderer places it in that parameter's header, immediately
 * above the active input representation. */
export class RepresentationSelectControl<T extends string = string> extends SelectControl<T> {
  readonly parameterKey: string

  constructor(
    parameterKey: string,
    label: string,
    options: readonly { value: T; label: string }[],
    initial: T,
  ) {
    super(label, options, initial)
    this.parameterKey = parameterKey
  }
}

/** A deliberately small progressive-disclosure affordance. Nodes own their
 * semantic choices; this control only renders the available add/remove
 * actions and avoids a generic parameter-schema framework. */
export interface ParameterAction {
  id: string
  label: string
  run?: () => void
  children?: readonly ParameterAction[]
  disabled?: boolean
  title?: string
}

export class ParameterActionsControl extends ClassicPreset.Control {
  readonly actions: () => readonly ParameterAction[]

  constructor(actions: () => readonly ParameterAction[]) {
    super()
    this.actions = actions
  }
}

import { ClassicPreset } from 'rete'
import type { DataflowNode } from 'rete-engine'

import { t } from '../../i18n/translate'
import type { TransformResult, Vector3Params, Vector3Representation } from '../../openscad/transform'
import { LabeledNumberControl, ParameterActionsControl, type ParameterAction, type RemovableRow } from '../controls'
import { geometrySocket, numberSocket, vector3Socket, type BooleanValue, type GeometryValue, type NumberValue, type Vector3Value } from '../sockets'

type VectorTransformControls = {
  x?: LabeledNumberControl
  y?: LabeledNumberControl
  z?: LabeledNumberControl
  actions: ParameterActionsControl
} & Record<string, ClassicPreset.Control | undefined>

export type VectorTransformInputs = Record<string, (GeometryValue | NumberValue | Vector3Value | BooleanValue)[] | undefined>

/**
 * Shared shape for OpenSCAD's single-child vector transforms
 * (translate/rotate/scale/mirror/resize): one geometry input, an X/Y/Z (or
 * Vector) control set chosen through the header Add menu, and one geometry
 * output. Subclasses may add further optional arguments through the small
 * protected hooks below (Resize's `auto`). Extracted alongside `openscad/transform.ts`'s
 * `vectorTransformToOpenSCAD` because `TranslateNode`/`RotateNode`/
 * `ScaleNode` would otherwise be near-identical duplicates of both the
 * node wiring and the codegen call.
 */
export class VectorTransformNode
  extends ClassicPreset.Node<
    Record<string, ClassicPreset.Socket>,
    { geometry: ClassicPreset.Socket },
    VectorTransformControls
  >
  implements DataflowNode
{
  private readonly toOpenSCAD: (params: Vector3Params, input: string | undefined) => TransformResult
  /** The OpenSCAD module name. Explicit, because a translated display label
   * must never become generated source. */
  private readonly openscadName: string
  protected readonly notify?: () => void
  protected readonly requestRemoveForm?: (keys: readonly string[], label: string) => Promise<boolean>
  /** `undefined` means the last remaining form was removed - a valid,
   * syntactically empty `translate()`/`rotate()`/`scale()` call. */
  private representation: Exclude<Vector3Representation, 'none'> | undefined
  private xyzLiteral: Pick<Vector3Params, 'x' | 'y' | 'z'>

  constructor(
    label: string,
    openscadName: string,
    defaults: Vector3Params,
    toOpenSCAD: (params: Vector3Params, input: string | undefined) => TransformResult,
    notify?: () => void,
    requestRemoveForm?: (keys: readonly string[], label: string) => Promise<boolean>,
  ) {
    super(label)
    this.openscadName = openscadName
    this.toOpenSCAD = toOpenSCAD
    this.notify = notify
    this.requestRemoveForm = requestRemoveForm
    // New nodes still start with their useful default XYZ form
    // (node-style.md "Add parameter"); only an explicitly persisted
    // `'none'` (a form the user removed and then saved) restores empty.
    this.representation = defaults.representation === 'none' ? undefined : (defaults.representation ?? 'xyz')
    this.xyzLiteral = { x: defaults.x, y: defaults.y, z: defaults.z }

    this.addInput('geometry', new ClassicPreset.Input(geometrySocket, t('input.geometry')))
    if (this.representation) this.addActiveRepresentation(this.representation)
    this.addControl('actions', new ParameterActionsControl(() => this.actions()))
    this.addOutput('geometry', new ClassicPreset.Output(geometrySocket, t('input.geometry')))
  }

  /** Extracts this node's semantic parameters, e.g. for `.scadlet` persistence (see `editor/node-catalog.ts`) - the same values `data()` generates OpenSCAD from. */
  getPersistedParams(): Vector3Params {
    return {
      x: this.xyzLiteral.x,
      y: this.xyzLiteral.y,
      z: this.xyzLiteral.z,
      representation: this.representation ?? 'none',
    }
  }

  data(inputs: VectorTransformInputs): { geometry: GeometryValue } {
    const input = inputs.geometry?.[0]?.code
    if (this.representation === undefined) {
      if (!input) return { geometry: this.toOpenSCAD({ x: 0, y: 0, z: 0 }, input) }
      return { geometry: this.toOpenSCADExpressionNoArgs(input, this.extraArguments(inputs)) }
    }
    if (this.representation === 'vector') {
      const vector = inputs.vector?.[0]?.code
      if (!vector) {
        const error = `${this.label} is missing its Vector input`
        return { geometry: { code: `// ${error}`, error } }
      }
      return { geometry: this.toOpenSCADExpression(vector, input, this.extraArguments(inputs)) }
    }
    const x = inputs.x?.[0]?.code ?? String(this.xyzLiteral.x)
    const y = inputs.y?.[0]?.code ?? String(this.xyzLiteral.y)
    const z = inputs.z?.[0]?.code ?? String(this.xyzLiteral.z)
    return { geometry: this.toOpenSCADExpression(`[${x}, ${y}, ${z}]`, input, this.extraArguments(inputs)) }
  }

  /** Further optional Add-menu entries of a subclass. */
  protected extraActions(): ParameterAction[] { return [] }
  /** Further row-level Remove actions of a subclass. */
  protected extraRemovableRows(): RemovableRow[] { return [] }
  /** Further `name=value` arguments of a subclass, after the vector. */
  protected extraArguments(_inputs: VectorTransformInputs): string[] { return [] }

  private addActiveRepresentation(representation: Exclude<Vector3Representation, 'none'>): void {
    if (representation === 'vector') {
      this.addInput('vector', new ClassicPreset.Input(vector3Socket, t('mode.vector')))
      return
    }
    for (const [key, label, value] of [
      ['x', t('control.x'), this.xyzLiteral.x],
      ['y', t('control.y'), this.xyzLiteral.y],
      ['z', t('control.z'), this.xyzLiteral.z],
    ] as const) {
      this.addInput(key, new ClassicPreset.Input(numberSocket, label))
      this.addControl(key, new LabeledNumberControl(label, {
        initial: value,
        change: (next) => { this.xyzLiteral = { ...this.xyzLiteral, [key]: next } },
      }))
    }
  }

  private captureXYZLiteral(): void {
    if (this.representation !== 'xyz') return
    this.xyzLiteral = {
      x: this.controls.x?.value ?? this.xyzLiteral.x,
      y: this.controls.y?.value ?? this.xyzLiteral.y,
      z: this.controls.z?.value ?? this.xyzLiteral.z,
    }
  }

  private activeRepresentationKeys(): string[] {
    return ['vector', 'x', 'y', 'z'].filter((key) => Boolean(this.inputs[key]))
  }

  /** Header Add menu entries: the vector forms while none is active, plus
   * any absent optional argument of a subclass. */
  private actions(): readonly ParameterAction[] {
    const forms: ParameterAction[] = this.representation ? [] : [
      { id: 'add-xyz', label: t('mode.xyz'), run: () => { this.addActiveRepresentation('xyz'); this.representation = 'xyz'; this.notify?.() } },
      { id: 'add-vector', label: t('mode.vector'), run: () => { this.addActiveRepresentation('vector'); this.representation = 'vector'; this.notify?.() } },
    ]
    return [...forms, ...this.extraActions()]
  }

  /** Row-level Remove buttons: the vector form plus any subclass argument. */
  removableRows(): readonly RemovableRow[] {
    const keys = this.activeRepresentationKeys()
    if (keys.length === 0 || !this.representation) return this.extraRemovableRows()
    const label = this.representation === 'vector' ? t('mode.vector') : t('mode.xyz')
    return [{ key: keys[0]!, label, requestRemove: () => this.requestRemoveRepresentation() }, ...this.extraRemovableRows()]
  }

  private async requestRemoveRepresentation(): Promise<boolean> {
    const keys = this.activeRepresentationKeys()
    if (keys.length === 0 || !this.representation) return false
    const label = this.representation === 'vector' ? t('mode.vector') : t('mode.xyz')
    if (!(await (this.requestRemoveForm?.(keys, label) ?? Promise.resolve(true)))) return false
    this.captureXYZLiteral()
    for (const key of ['vector', 'x', 'y', 'z'] as const) if (this.inputs[key]) this.removeInput(key)
    for (const key of ['x', 'y', 'z'] as const) if (this.controls[key]) this.removeControl(key)
    this.representation = undefined
    this.notify?.()
    return true
  }

  private toOpenSCADExpression(vector: string, input: string | undefined, extra: readonly string[]): TransformResult {
    // The current generator accepts literal Vector3Params. Passing an
    // expression here is intentional: this is the one semantic boundary
    // where a connected value replaces an inline literal.
    if (!input) return this.toOpenSCAD({ x: 0, y: 0, z: 0 }, input)
    return { code: `${this.openscadName}(${[vector, ...extra].join(', ')}) {\n${input.split('\n').map((line) => `    ${line}`).join('\n')}\n}` }
  }

  /** No vector form: OpenSCAD's own argument-less call (plus any optional
   * subclass argument). */
  private toOpenSCADExpressionNoArgs(input: string, extra: readonly string[]): TransformResult {
    return { code: `${this.openscadName}(${extra.join(', ')}) {\n${input.split('\n').map((line) => `    ${line}`).join('\n')}\n}` }
  }
}

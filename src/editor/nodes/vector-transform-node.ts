import { ClassicPreset } from 'rete'
import type { DataflowNode } from 'rete-engine'

import { t } from '../../i18n/translate'
import type { TransformResult, Vector3Params, Vector3Representation } from '../../openscad/transform'
import { LabeledNumberControl, RepresentationSelectControl } from '../controls'
import { geometrySocket, numberSocket, vector3Socket, type GeometryValue, type NumberValue, type Vector3Value } from '../sockets'

type VectorTransformControls = {
  vectorMode: RepresentationSelectControl<Vector3Representation>
  x: LabeledNumberControl
  y: LabeledNumberControl
  z: LabeledNumberControl
}

/**
 * Shared shape for OpenSCAD's single-child vector transforms
 * (translate/rotate/scale): one geometry input, an X/Y/Z control triplet,
 * and one geometry output. Extracted alongside
 * `openscad/transform.ts`'s `vectorTransformToOpenSCAD` because
 * `TranslateNode`/`RotateNode`/`ScaleNode` would otherwise be near-
 * identical duplicates of both the node wiring and the codegen call.
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
  private readonly notify?: () => void
  private readonly canSwitch?: () => boolean
  private representation: Vector3Representation
  private xyzLiteral: Pick<Vector3Params, 'x' | 'y' | 'z'>

  constructor(
    label: string,
    defaults: Vector3Params,
    toOpenSCAD: (params: Vector3Params, input: string | undefined) => TransformResult,
    notify?: () => void,
    canSwitch?: () => boolean,
  ) {
    super(label)
    this.toOpenSCAD = toOpenSCAD
    this.notify = notify
    this.canSwitch = canSwitch
    this.representation = defaults.representation ?? 'xyz'
    this.xyzLiteral = { x: defaults.x, y: defaults.y, z: defaults.z }

    this.addInput('geometry', new ClassicPreset.Input(geometrySocket, t('input.geometry')))
    const mode = new RepresentationSelectControl('vector', label, [
      { value: 'xyz', label: t('mode.xyz') },
      { value: 'vector', label: t('mode.vector') },
    ], this.representation)
    mode.onChange = (next) => this.switchRepresentation(next)
    this.addControl('vectorMode', mode)
    this.addActiveRepresentation(this.representation)
    this.addOutput('geometry', new ClassicPreset.Output(geometrySocket, t('input.geometry')))
  }

  /** Extracts this node's semantic parameters, e.g. for `.scadlet` persistence (see `editor/node-catalog.ts`) - the same values `data()` generates OpenSCAD from. */
  getPersistedParams(): Vector3Params {
    return {
      x: this.xyzLiteral.x,
      y: this.xyzLiteral.y,
      z: this.xyzLiteral.z,
      representation: this.representation,
    }
  }

  data(inputs: Record<string, (GeometryValue | NumberValue | Vector3Value)[] | undefined>): { geometry: GeometryValue } {
    const input = inputs.geometry?.[0]?.code
    if (this.representation === 'vector') {
      const vector = inputs.vector?.[0]?.code
      if (!vector) {
        const error = `${this.label} is missing its Vector input`
        return { geometry: { code: `// ${error}`, error } }
      }
      return { geometry: this.toOpenSCADExpression(vector, input) }
    }
    const x = inputs.x?.[0]?.code ?? String(this.xyzLiteral.x)
    const y = inputs.y?.[0]?.code ?? String(this.xyzLiteral.y)
    const z = inputs.z?.[0]?.code ?? String(this.xyzLiteral.z)
    return { geometry: this.toOpenSCADExpression(`[${x}, ${y}, ${z}]`, input) }
  }

  private addActiveRepresentation(representation: Vector3Representation): void {
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

  private switchRepresentation(next: Vector3Representation): void {
    if (next === this.representation) return
    if (this.canSwitch && !this.canSwitch()) {
      this.controls.vectorMode.value = this.representation
      return
    }
    this.captureXYZLiteral()
    for (const key of ['vector', 'x', 'y', 'z'] as const) {
      if (this.inputs[key]) this.removeInput(key)
    }
    for (const key of ['x', 'y', 'z'] as const) if (this.controls[key]) this.removeControl(key)
    this.representation = next
    this.addActiveRepresentation(next)
    this.notify?.()
  }

  private captureXYZLiteral(): void {
    if (this.representation !== 'xyz') return
    this.xyzLiteral = {
      x: this.controls.x?.value ?? this.xyzLiteral.x,
      y: this.controls.y?.value ?? this.xyzLiteral.y,
      z: this.controls.z?.value ?? this.xyzLiteral.z,
    }
  }

  private toOpenSCADExpression(vector: string, input: string | undefined): TransformResult {
    // The current generator accepts literal Vector3Params. Passing an
    // expression here is intentional: this is the one semantic boundary
    // where a connected value replaces an inline literal.
    if (!input) return this.toOpenSCAD({ x: 0, y: 0, z: 0 }, input)
    const name = this.label.toLowerCase()
    return { code: `${name}(${vector}) {\n${input.split('\n').map((line) => `    ${line}`).join('\n')}\n}` }
  }
}

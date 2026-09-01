import { ClassicPreset } from 'rete'
import type { DataflowNode } from 'rete-engine'

import { t } from '../../i18n/translate'
import type { TransformResult, Vector3Params } from '../../openscad/transform'
import { LabeledNumberControl } from '../controls'
import { geometrySocket, numberSocket, vector3Socket, type GeometryValue, type NumberValue, type Vector3Value } from '../sockets'

type VectorTransformControls = {
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

  constructor(
    label: string,
    defaults: Vector3Params,
    toOpenSCAD: (params: Vector3Params, input: string | undefined) => TransformResult,
  ) {
    super(label)
    this.toOpenSCAD = toOpenSCAD

    this.addInput('geometry', new ClassicPreset.Input(geometrySocket, 'Geometry'))
    // `vector` is the semantic argument. Component sockets are a convenient
    // partial override for literals; a connected whole vector takes
    // precedence and deliberately leaves component state/connections intact.
    this.addInput('vector', new ClassicPreset.Input(vector3Socket, 'Vector'))
    this.addInput('x', new ClassicPreset.Input(numberSocket, 'X'))
    this.addInput('y', new ClassicPreset.Input(numberSocket, 'Y'))
    this.addInput('z', new ClassicPreset.Input(numberSocket, 'Z'))
    this.addControl('x', new LabeledNumberControl(t('control.x'), { initial: defaults.x }))
    this.addControl('y', new LabeledNumberControl(t('control.y'), { initial: defaults.y }))
    this.addControl('z', new LabeledNumberControl(t('control.z'), { initial: defaults.z }))
    this.addOutput('geometry', new ClassicPreset.Output(geometrySocket, 'Geometry'))
  }

  /** Extracts this node's semantic parameters, e.g. for `.scadlet` persistence (see `editor/node-catalog.ts`) - the same values `data()` generates OpenSCAD from. */
  getPersistedParams(): Vector3Params {
    return {
      x: this.controls.x.value ?? 0,
      y: this.controls.y.value ?? 0,
      z: this.controls.z.value ?? 0,
    }
  }

  data(inputs: Record<string, (GeometryValue | NumberValue | Vector3Value)[] | undefined>): { geometry: GeometryValue } {
    const params = this.getPersistedParams()
    const input = inputs.geometry?.[0]?.code
    const vector = inputs.vector?.[0]?.code
    if (vector) return { geometry: this.toOpenSCADExpression(vector, input) }
    const x = inputs.x?.[0]?.code ?? String(params.x)
    const y = inputs.y?.[0]?.code ?? String(params.y)
    const z = inputs.z?.[0]?.code ?? String(params.z)
    return { geometry: this.toOpenSCADExpression(`[${x}, ${y}, ${z}]`, input) }
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

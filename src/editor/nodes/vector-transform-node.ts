import { ClassicPreset } from 'rete'
import type { DataflowNode } from 'rete-engine'

import { t } from '../../i18n/translate'
import type { TransformResult, Vector3Params } from '../../openscad/transform'
import { LabeledNumberControl } from '../controls'
import { geometrySocket, type GeometryValue } from '../sockets'

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
    { geometry: ClassicPreset.Socket },
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
    this.addControl('x', new LabeledNumberControl(t('control.x'), { initial: defaults.x }))
    this.addControl('y', new LabeledNumberControl(t('control.y'), { initial: defaults.y }))
    this.addControl('z', new LabeledNumberControl(t('control.z'), { initial: defaults.z }))
    this.addOutput('geometry', new ClassicPreset.Output(geometrySocket, 'Geometry'))
  }

  data(inputs: { geometry?: GeometryValue[] }): { geometry: GeometryValue } {
    const params: Vector3Params = {
      x: this.controls.x.value ?? 0,
      y: this.controls.y.value ?? 0,
      z: this.controls.z.value ?? 0,
    }
    const input = inputs.geometry?.[0]?.code

    return { geometry: this.toOpenSCAD(params, input) }
  }
}

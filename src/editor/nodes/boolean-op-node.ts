import { ClassicPreset } from 'rete'
import type { DataflowNode } from 'rete-engine'

import { geometrySocket, type GeometryValue } from '../sockets'

/**
 * Shared shape for OpenSCAD boolean operations that combine exactly two
 * geometry inputs into one output with no controls of their own (AGENTS.md:
 * "use two clearly named Geometry inputs" for Union/Intersection rather
 * than a variadic-port UI). `DifferenceNode` keeps its own, separate
 * definition since its input keys/labels (`base`/`subtract`) are
 * asymmetric rather than a genuine duplicate of this symmetric shape.
 */
export class BooleanOpNode
  extends ClassicPreset.Node<
    { a: ClassicPreset.Socket; b: ClassicPreset.Socket },
    { geometry: ClassicPreset.Socket },
    Record<string, never>
  >
  implements DataflowNode
{
  private readonly combine: (a: string | undefined, b: string | undefined) => GeometryValue

  constructor(
    label: string,
    inputLabels: { a: string; b: string },
    combine: (a: string | undefined, b: string | undefined) => GeometryValue,
  ) {
    super(label)
    this.combine = combine

    this.addInput('a', new ClassicPreset.Input(geometrySocket, inputLabels.a))
    this.addInput('b', new ClassicPreset.Input(geometrySocket, inputLabels.b))
    this.addOutput('geometry', new ClassicPreset.Output(geometrySocket, 'Geometry'))
  }

  data(inputs: { a?: GeometryValue[]; b?: GeometryValue[] }): { geometry: GeometryValue } {
    const a = inputs.a?.[0]?.code
    const b = inputs.b?.[0]?.code

    return { geometry: this.combine(a, b) }
  }
}

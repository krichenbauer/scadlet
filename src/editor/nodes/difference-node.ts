import { ClassicPreset } from 'rete'
import type { DataflowNode } from 'rete-engine'

import { differenceToOpenSCAD } from '../../openscad/csg'
import { geometrySocket, type GeometryValue } from '../sockets'

/**
 * The first geometry-composition node. Unlike Cube/Cylinder, it doesn't
 * calculate any geometry itself: it composes the OpenSCAD fragments
 * produced by its `base`/`subtract` inputs into a `difference() { ... }`
 * block, obtained through `rete-engine`'s recursive dataflow evaluation
 * (each `data()` call fetches its predecessors' `data()` results first).
 */
export class DifferenceNode
  extends ClassicPreset.Node<
    { base: ClassicPreset.Socket; subtract: ClassicPreset.Socket },
    { geometry: ClassicPreset.Socket },
    Record<string, never>
  >
  implements DataflowNode
{
  constructor() {
    super('Difference')
    this.addInput('base', new ClassicPreset.Input(geometrySocket, 'Base'))
    this.addInput('subtract', new ClassicPreset.Input(geometrySocket, 'Subtract'))
    this.addOutput('geometry', new ClassicPreset.Output(geometrySocket, 'Geometry'))
  }

  data(inputs: { base?: GeometryValue[]; subtract?: GeometryValue[] }): { geometry: GeometryValue } {
    const base = inputs.base?.[0]?.code
    const subtract = inputs.subtract?.[0]?.code

    return { geometry: differenceToOpenSCAD(base, subtract) }
  }
}

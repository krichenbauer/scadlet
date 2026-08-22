import { ClassicPreset } from 'rete'

import { geometrySocket } from '../schemes'

/**
 * The simplest possible geometry primitive, corresponding to OpenSCAD's
 * `cube(size)`. It has no inputs and a single "size" parameter edited
 * directly on the node, per AGENTS.md's guidance to avoid forcing a
 * separate value node for every literal.
 */
export class CubeNode extends ClassicPreset.Node<
  Record<string, never>,
  { geometry: ClassicPreset.Socket },
  { size: ClassicPreset.InputControl<'number'> }
> {
  constructor(size = 10) {
    super('Cube')

    this.addControl('size', new ClassicPreset.InputControl('number', { initial: size }))
    this.addOutput('geometry', new ClassicPreset.Output(geometrySocket, 'Geometry'))
  }
}

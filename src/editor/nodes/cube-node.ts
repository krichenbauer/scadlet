import { ClassicPreset } from 'rete'
import type { DataflowNode } from 'rete-engine'

import { cubeToOpenSCAD, DEFAULT_CUBE_PARAMS, type CubeParams } from '../../openscad/cube'
import { CheckboxControl, LabeledNumberControl } from '../controls'
import { geometrySocket, type GeometryValue } from '../sockets'

type CubeControls = {
  sizeX: LabeledNumberControl
  sizeY: LabeledNumberControl
  sizeZ: LabeledNumberControl
  center: CheckboxControl
}

/**
 * The `cube()` primitive. Models OpenSCAD's actual parameters (a size
 * that's a scalar or a per-axis vector, plus `center`) directly as node
 * controls, per AGENTS.md's guidance to avoid forcing separate value
 * nodes for simple literals. Evaluates itself into OpenSCAD via `data()`,
 * which is all `rete-engine`'s `DataflowEngine` requires of a node.
 */
export class CubeNode
  extends ClassicPreset.Node<Record<string, never>, { geometry: ClassicPreset.Socket }, CubeControls>
  implements DataflowNode
{
  constructor(params: Partial<CubeParams> = {}) {
    super('Cube')

    const { sizeX, sizeY, sizeZ, center } = { ...DEFAULT_CUBE_PARAMS, ...params }

    this.addControl('sizeX', new LabeledNumberControl('X', { initial: sizeX }))
    this.addControl('sizeY', new LabeledNumberControl('Y', { initial: sizeY }))
    this.addControl('sizeZ', new LabeledNumberControl('Z', { initial: sizeZ }))
    this.addControl('center', new CheckboxControl('Center', center))
    this.addOutput('geometry', new ClassicPreset.Output(geometrySocket, 'Geometry'))
  }

  /** Extracts this node's semantic parameters, e.g. for `.scadlet` persistence (see `editor/node-catalog.ts`) - the same values `data()` generates OpenSCAD from. */
  getPersistedParams(): CubeParams {
    return {
      sizeX: this.controls.sizeX.value ?? DEFAULT_CUBE_PARAMS.sizeX,
      sizeY: this.controls.sizeY.value ?? DEFAULT_CUBE_PARAMS.sizeY,
      sizeZ: this.controls.sizeZ.value ?? DEFAULT_CUBE_PARAMS.sizeZ,
      center: this.controls.center.value,
    }
  }

  data(): { geometry: GeometryValue } {
    return { geometry: { code: cubeToOpenSCAD(this.getPersistedParams()) } }
  }
}

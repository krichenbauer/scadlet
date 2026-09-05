import { ClassicPreset } from 'rete'
import type { DataflowNode } from 'rete-engine'

import { geometrySocket, type GeometryValue } from '../sockets'
import { t } from '../../i18n/translate'

/** A project-defined Module use. Its stable definition ID is the semantic
 * reference; the visible/OpenSCAD name is resolved from that definition at
 * construction time, never persisted as a second authority. */
export class ModuleCallNode extends ClassicPreset.Node<never, { geometry: ClassicPreset.Socket }> implements DataflowNode {
  readonly definitionId: string
  private readonly moduleName: string

  constructor(
    definitionId: string,
    moduleName: string,
  ) {
    super(moduleName)
    this.definitionId = definitionId
    this.moduleName = moduleName
    this.addOutput('geometry', new ClassicPreset.Output(geometrySocket, t('input.geometry')))
  }

  data(): { geometry: GeometryValue } {
    return { geometry: { code: `${this.moduleName}();` } }
  }
}

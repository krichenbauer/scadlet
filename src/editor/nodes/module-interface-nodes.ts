import { ClassicPreset } from 'rete'
import type { DataflowNode } from 'rete-engine'

import { t } from '../../i18n/translate'
import { geometrySocket } from '../sockets'

/** The fixed parameter interface of a Module definition. Phase 1 has no
 * parameters yet, but the node is a real, stable part of that definition's
 * graph rather than a decorative frame label. */
export class ModuleInputsNode extends ClassicPreset.Node implements DataflowNode {
  constructor() {
    super(t('node.moduleInputs'))
  }

  data(): Record<string, never> { return {} }
}

/** SCADlet's explicit Geometry body root for a Module definition. It is a
 * sink, not an OpenSCAD return statement, and intentionally has no output. */
export class ModuleOutputNode extends ClassicPreset.Node<{ geometry: ClassicPreset.Socket }> implements DataflowNode {
  constructor() {
    super(t('node.moduleOutput'))
    this.addInput('geometry', new ClassicPreset.Input(geometrySocket, t('input.geometry')))
  }

  data(): Record<string, never> { return {} }
}

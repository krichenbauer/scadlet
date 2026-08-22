import { NodeEditor } from 'rete'
import { AreaExtensions, AreaPlugin } from 'rete-area-plugin'
import { ConnectionPlugin, Presets as ConnectionPresets } from 'rete-connection-plugin'
import { DataflowEngine } from 'rete-engine'

import { evaluateOpenSCAD } from './evaluate'
import { CubeNode } from './nodes/cube-node'
import { CylinderNode } from './nodes/cylinder-node'
import { DifferenceNode } from './nodes/difference-node'
import { attachRenderer } from './render'
import type { AreaExtra, Schemes } from './schemes'

export interface SCADletEditor {
  editor: NodeEditor<Schemes>
  area: AreaPlugin<Schemes, AreaExtra>
  addCubeNode(): Promise<void>
  addCylinderNode(): Promise<void>
  addDifferenceNode(): Promise<void>
  evaluate(): Promise<string>
  destroy(): void
}

/**
 * Wires up the minimum set of Rete plugins needed to add and connect
 * nodes on screen: the graph itself, the pan/zoom area, drag-to-connect
 * behavior, and the Lit-based renderer.
 *
 * Graph evaluation / OpenSCAD code generation is intentionally out of
 * scope here and will be added in a later step.
 */
export async function createEditor(container: HTMLElement): Promise<SCADletEditor> {
  const editor = new NodeEditor<Schemes>()
  const area = new AreaPlugin<Schemes, AreaExtra>(container)
  const connection = new ConnectionPlugin<Schemes, AreaExtra>()
  const engine = new DataflowEngine<Schemes>((node) => ({
    inputs: () => Object.keys(node.inputs),
    outputs: () => Object.keys(node.outputs),
  }))

  AreaExtensions.selectableNodes(area, AreaExtensions.selector(), {
    accumulating: AreaExtensions.accumulateOnCtrl(),
  })

  connection.addPreset(ConnectionPresets.classic.setup())

  editor.use(area)
  editor.use(engine)
  area.use(connection)
  attachRenderer(area, connection)

  AreaExtensions.simpleNodesOrder(area)

  async function addCubeNode() {
    const node = new CubeNode()
    await editor.addNode(node)
    await AreaExtensions.zoomAt(area, editor.getNodes())
  }

  async function addCylinderNode() {
    const node = new CylinderNode({}, () => void area.update('node', node.id))
    await editor.addNode(node)
    await AreaExtensions.zoomAt(area, editor.getNodes())
  }

  async function addDifferenceNode() {
    const node = new DifferenceNode()
    await editor.addNode(node)
    await AreaExtensions.zoomAt(area, editor.getNodes())
  }

  await addCubeNode()

  return {
    editor,
    area,
    addCubeNode,
    addCylinderNode,
    addDifferenceNode,
    evaluate: () => evaluateOpenSCAD(editor, engine),
    destroy: () => area.destroy(),
  }
}

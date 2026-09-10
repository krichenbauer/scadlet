import { describe, expect, it } from 'vitest'

import { catalogProducesGeometry, hasGeometryOutput } from './geometry-accent'
import { findCatalogEntry } from './node-catalog'
import { CubeNode } from './nodes/cube-node'
import { CylinderNode } from './nodes/cylinder-node'
import { DifferenceNode } from './nodes/difference-node'
import { IntersectionNode } from './nodes/intersection-node'
import { RotateNode } from './nodes/rotate-node'
import { ScaleNode } from './nodes/scale-node'
import { SphereNode } from './nodes/sphere-node'
import { TranslateNode } from './nodes/translate-node'
import { UnionNode } from './nodes/union-node'
import { ModuleCallNode } from './nodes/module-call-node'
import { ModuleInputsNode, ModuleOutputNode } from './nodes/module-interface-nodes'
import { FunctionCallNode } from './nodes/function-call-node'
import { FunctionInputsNode, FunctionOutputNode } from './nodes/function-interface-nodes'
import { ArithmeticNode, BasicMathNode, BooleanNode, CompareNode, ConditionalNode, ExponentialLogNode, NumberNode, TrigonometryNode, Vector3Node } from './nodes/value-nodes'
import { geometrySocket, numberSocket } from './sockets'

describe('Geometry accent classification', () => {
  it('marks every Geometry producer from its canonical output socket identity', () => {
    for (const node of [
      new CubeNode(), new CylinderNode(), new SphereNode(),
      new TranslateNode(), new RotateNode(), new ScaleNode(),
      new DifferenceNode(), new UnionNode(), new IntersectionNode(),
      new ModuleCallNode({ id: 'wheel', name: 'wheel', parameters: [], geometryInputs: [] }),
    ]) expect(hasGeometryOutput(node.outputs)).toBe(true)
  })

  it('leaves every current Value-only/interface node neutral', () => {
    for (const node of [
      new NumberNode(), new BooleanNode(), new Vector3Node(), new ArithmeticNode(),
      new TrigonometryNode(), new BasicMathNode(), new ExponentialLogNode(),
      new CompareNode(), new ConditionalNode(), new FunctionInputsNode(), new FunctionOutputNode(),
      new FunctionCallNode({ id: 'double', name: 'double', parameters: [], resultType: 'number' }, { definitionId: 'double' }),
      new ModuleOutputNode(),
    ]) expect(hasGeometryOutput(node.outputs)).toBe(false)
  })

  it('tracks dynamic Module Inputs Geometry outputs without stale classification', () => {
    const inputs = new ModuleInputsNode()
    expect(hasGeometryOutput(inputs.outputs)).toBe(false)

    inputs.syncSignature([], [{ id: 'child', name: 'Child geometry' }])
    expect(hasGeometryOutput(inputs.outputs)).toBe(true)

    inputs.syncSignature([], [])
    expect(hasGeometryOutput(inputs.outputs)).toBe(false)
  })

  it('uses canonical socket identity even when the output port key is not "geometry"', () => {
    expect(hasGeometryOutput({ result: { socket: geometrySocket } })).toBe(true)
    // A lookalike display/name value is not sufficient to manufacture a
    // Geometry classification outside SCADlet's canonical socket vocabulary.
    expect(hasGeometryOutput({ geometry: { socket: numberSocket } })).toBe(false)
  })

  it('gives only catalog entries with Geometry output ports the palette cue', () => {
    for (const type of ['cube', 'translate', 'union'] as const) {
      expect(catalogProducesGeometry(findCatalogEntry(type)!)).toBe(true)
    }
    for (const type of ['number', 'vector3', 'arithmetic', 'compare', 'conditional'] as const) {
      expect(catalogProducesGeometry(findCatalogEntry(type)!)).toBe(false)
    }
  })
})

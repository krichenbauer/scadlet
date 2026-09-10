import { describe, expect, it } from 'vitest'

import { catalogProducesGeometry, hasGeometryOutput } from './geometry-accent'
import { findCatalogEntry } from './node-catalog'
import { CubeNode } from './nodes/cube-node'
import { ModuleCallNode } from './nodes/module-call-node'
import { ModuleInputsNode, ModuleOutputNode } from './nodes/module-interface-nodes'
import { FunctionCallNode } from './nodes/function-call-node'
import { ArithmeticNode, CompareNode, ConditionalNode, NumberNode } from './nodes/value-nodes'

describe('Geometry accent classification', () => {
  it('marks Geometry producers from their real outputs and leaves Value-only nodes neutral', () => {
    expect(hasGeometryOutput(new CubeNode().outputs)).toBe(true)
    expect(hasGeometryOutput(new ModuleCallNode({ id: 'wheel', name: 'wheel', parameters: [], geometryInputs: [] }).outputs)).toBe(true)
    expect(hasGeometryOutput(new NumberNode().outputs)).toBe(false)
    expect(hasGeometryOutput(new ArithmeticNode().outputs)).toBe(false)
    expect(hasGeometryOutput(new CompareNode().outputs)).toBe(false)
    expect(hasGeometryOutput(new ConditionalNode().outputs)).toBe(false)
    expect(hasGeometryOutput(new FunctionCallNode({ id: 'double', name: 'double', parameters: [], resultType: 'number' }, { definitionId: 'double' }).outputs)).toBe(false)
    expect(hasGeometryOutput(new ModuleOutputNode().outputs)).toBe(false)
  })

  it('tracks dynamic Module Inputs Geometry outputs without stale classification', () => {
    const inputs = new ModuleInputsNode()
    expect(hasGeometryOutput(inputs.outputs)).toBe(false)

    inputs.syncSignature([], [{ id: 'child', name: 'Child geometry' }])
    expect(hasGeometryOutput(inputs.outputs)).toBe(true)

    inputs.syncSignature([], [])
    expect(hasGeometryOutput(inputs.outputs)).toBe(false)
  })

  it('uses port semantics rather than rendered titles or labels', () => {
    expect(hasGeometryOutput({ output: { socket: { name: 'geometry' } } })).toBe(true)
    expect(hasGeometryOutput({ Geometry: { socket: { name: 'number' } } })).toBe(false)
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

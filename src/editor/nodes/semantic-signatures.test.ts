import { describe, expect, it } from 'vitest'

import { CubeNode } from './cube-node'
import { TranslateNode } from './translate-node'
import { UnionNode } from './union-node'
import { parseScadletProject } from '../../persistence/validate'

describe('Milestone 6 semantic node signatures', () => {
  it('a catalog-style fresh Cube emits OpenSCADs empty legal signature', () => {
    expect(new CubeNode({}, () => {}).data({}).geometry.code).toBe('cube();')
  })

  it('a Number connection replaces the preserved Cube size literal', () => {
    const cube = new CubeNode({ size: 10 }, () => {})
    expect(cube.data({ size: [{ code: 'width' }] }).geometry.code).toBe('cube(width);')
    expect(cube.getPersistedParams()).toEqual({ size: 10 })
  })

  it('a whole Vector3 connection takes precedence over components', () => {
    const transform = new TranslateNode({ x: 1, y: 2, z: 3 })
    expect(transform.data({ geometry: [{ code: 'cube();' }], vector: [{ code: 'offset' }], x: [{ code: 'x' }] }).geometry.code).toBe(
      'translate(offset) {\n    cube();\n}',
    )
  })

  it('a variadic Union keeps ordered stable child ports and an extension slot', () => {
    const union = new UnionNode({}, false)
    const first = Object.keys(union.inputs)[0]!
    union.synchronizeChildren(new Set([first]))
    const ports = Object.keys(union.inputs)
    expect(ports).toHaveLength(2)
    expect(union.data({ [ports[0]!]: [{ code: 'cube();' }], [ports[1]!]: [{ code: 'sphere();' }] }).geometry.code).toBe(
      'union() {\n    cube();\n    sphere();\n}',
    )
  })

  it('migrates v1 Cube and fixed Union ports into v2 semantic identities', () => {
    const project = parseScadletProject({
      format: 'scadlet', version: 1, metadata: { name: 'Old' },
      graph: {
        nodes: [
          { id: 'cube', type: 'cube', position: { x: 0, y: 0 }, parameters: { sizeX: 2, sizeY: 3, sizeZ: 4, center: false } },
          { id: 'union', type: 'union', position: { x: 1, y: 0 }, parameters: {} },
        ],
        connections: [{ id: 'c', source: 'cube', sourceOutput: 'geometry', target: 'union', targetInput: 'a' }],
      },
      editor: { viewport: { x: 0, y: 0, zoom: 1 } }, viewer: { camera: { position: [0, 0, 0], target: [0, 0, 0] } },
    })
    expect(project.version).toBe(2)
    expect(project.graph.nodes[0]?.parameters).toEqual({ size: { x: 2, y: 3, z: 4 } })
    expect(project.graph.connections[0]?.targetInput).toBe('child:v1-a')
  })
})

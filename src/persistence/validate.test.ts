import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { createEmptyProject } from './project'
import { parseScadletProject, parseScadletProjectText, ScadletProjectError } from './validate'

/** A minimal, valid populated v1 project used as a base for mutation-based invalid-input tests. Loosely typed (`any`) on purpose - tests deliberately assign malformed values to individual fields to exercise validation. */
function validProject(): any {
  return {
    format: 'scadlet',
    version: 1,
    metadata: { name: 'Test Project' },
    graph: {
      nodes: [
        { id: 'cube-1', type: 'cube', position: { x: 0, y: 0 }, parameters: { sizeX: 10, sizeY: 10, sizeZ: 10, center: false } },
        { id: 'sphere-1', type: 'sphere', position: { x: 100, y: 0 }, parameters: { mode: 'radius', r: 5, d: 10 } },
        {
          id: 'union-1',
          type: 'union',
          position: { x: 200, y: 0 },
          parameters: {},
        },
      ],
      connections: [
        { id: 'c1', source: 'cube-1', sourceOutput: 'geometry', target: 'union-1', targetInput: 'a' },
        { id: 'c2', source: 'sphere-1', sourceOutput: 'geometry', target: 'union-1', targetInput: 'b' },
      ],
    },
    editor: { viewport: { x: 0, y: 0, zoom: 1 } },
    viewer: { camera: { position: [80, 80, 60], target: [0, 0, 0] } },
  }
}

describe('parseScadletProject: valid input', () => {
  it('parses a minimal valid empty v1 project', () => {
    const project = parseScadletProject(createEmptyProject())
    expect(project.graph.nodes).toEqual([])
    expect(project.graph.connections).toEqual([])
  })

  it('parses a valid populated project', () => {
    const project = parseScadletProject(validProject())
    expect(project.graph.nodes).toHaveLength(3)
    expect(project.graph.connections).toHaveLength(2)
    expect(project.metadata.name).toBe('Test Project')
  })

  it('is not affected by extra unknown top-level/nested fields (forward compatibility)', () => {
    const raw = validProject() as Record<string, unknown>
    ;(raw.editor as Record<string, unknown>).annotations = []
    raw.somethingFuture = { whatever: true }
    expect(() => parseScadletProject(raw)).not.toThrow()
  })
})

describe('parseScadletProjectText', () => {
  it('rejects invalid JSON', () => {
    expect(() => parseScadletProjectText('{not json')).toThrow(ScadletProjectError)
    expect(() => parseScadletProjectText('{not json')).toThrow('not valid JSON')
  })

  it('parses valid JSON text', () => {
    const project = parseScadletProjectText(JSON.stringify(createEmptyProject()))
    expect(project.format).toBe('scadlet')
  })
})

describe('parseScadletProject: top-level structure', () => {
  it('rejects a top-level array', () => {
    expect(() => parseScadletProject([])).toThrow('must be a JSON object')
  })

  it('rejects a top-level primitive', () => {
    expect(() => parseScadletProject('scadlet')).toThrow('must be a JSON object')
    expect(() => parseScadletProject(42)).toThrow('must be a JSON object')
    expect(() => parseScadletProject(null)).toThrow('must be a JSON object')
  })

  it('rejects a wrong "format"', () => {
    const raw = { ...validProject(), format: 'not-scadlet' }
    expect(() => parseScadletProject(raw)).toThrow('unexpected "format" value "not-scadlet"')
  })

  it('rejects a missing "format"', () => {
    const raw = validProject() as Record<string, unknown>
    delete raw.format
    expect(() => parseScadletProject(raw)).toThrow('missing "format"')
  })

  it('rejects a missing "version"', () => {
    const raw = validProject() as Record<string, unknown>
    delete raw.version
    expect(() => parseScadletProject(raw)).toThrow('missing a numeric "version"')
  })

  it('rejects an unsupported future version', () => {
    const raw = { ...validProject(), version: 7 }
    expect(() => parseScadletProject(raw)).toThrow('Unsupported SCADlet project version: 7')
  })
})

describe('parseScadletProject: metadata', () => {
  it('rejects invalid metadata (not an object)', () => {
    const raw = { ...validProject(), metadata: 'oops' }
    expect(() => parseScadletProject(raw)).toThrow('"metadata" must be an object')
  })

  it('rejects a missing project name', () => {
    const raw = { ...validProject(), metadata: {} }
    expect(() => parseScadletProject(raw)).toThrow('missing a project "name"')
  })

  it('rejects a blank project name', () => {
    const raw = { ...validProject(), metadata: { name: '   ' } }
    expect(() => parseScadletProject(raw)).toThrow('missing a project "name"')
  })
})

describe('parseScadletProject: nodes', () => {
  it('rejects "graph.nodes" not being an array', () => {
    const raw = validProject()
    ;(raw.graph as Record<string, unknown>).nodes = {}
    expect(() => parseScadletProject(raw)).toThrow('"graph.nodes" must be an array')
  })

  it('rejects duplicate node ids', () => {
    const raw = validProject()
    raw.graph.nodes.push({ ...raw.graph.nodes[0] })
    expect(() => parseScadletProject(raw)).toThrow('Duplicate node id: "cube-1"')
  })

  it('rejects an unknown node type', () => {
    const raw = validProject()
    raw.graph.nodes[0].type = 'foobar'
    expect(() => parseScadletProject(raw)).toThrow('Unknown node type: "foobar"')
  })

  it('rejects a malformed node position', () => {
    const raw = validProject()
    ;(raw.graph.nodes[0] as Record<string, unknown>).position = { x: 0 }
    expect(() => parseScadletProject(raw)).toThrow('position')
  })

  it('rejects non-finite coordinates', () => {
    const raw = validProject()
    raw.graph.nodes[0].position = { x: Number.NaN, y: 0 }
    expect(() => parseScadletProject(raw)).toThrow('position')
  })

  it('rejects a wrong parameter shape for a known node type, with a useful message', () => {
    const raw = validProject()
    raw.graph.nodes[0].parameters = { sizeX: 'oops', sizeY: 10, sizeZ: 10, center: false }
    expect(() => parseScadletProject(raw)).toThrow('Invalid parameters for node "cube-1" (cube)')
    expect(() => parseScadletProject(raw)).toThrow('Invalid Cube parameter "sizeX"')
  })
})

describe('parseScadletProject: connections', () => {
  it('rejects "graph.connections" not being an array', () => {
    const raw = validProject()
    ;(raw.graph as Record<string, unknown>).connections = {}
    expect(() => parseScadletProject(raw)).toThrow('"graph.connections" must be an array')
  })

  it('rejects a connection referencing a missing source node', () => {
    const raw = validProject()
    raw.graph.connections[0].source = 'node-17'
    expect(() => parseScadletProject(raw)).toThrow('references missing source node "node-17"')
  })

  it('rejects a connection referencing a missing target node', () => {
    const raw = validProject()
    raw.graph.connections[0].target = 'node-99'
    expect(() => parseScadletProject(raw)).toThrow('references missing target node "node-99"')
  })

  it('rejects a connection referencing an unknown source port', () => {
    const raw = validProject()
    raw.graph.connections[0].sourceOutput = 'nope'
    expect(() => parseScadletProject(raw)).toThrow('unknown source port "nope"')
  })

  it('rejects a connection referencing an unknown target port', () => {
    const raw = validProject()
    raw.graph.connections[0].targetInput = 'nope'
    expect(() => parseScadletProject(raw)).toThrow('unknown target port "nope"')
  })

  it('rejects an incompatible typed connection before a project can be restored', () => {
    const raw = validProject()
    raw.graph.nodes.push({
      id: 'translate-1', type: 'translate', position: { x: 0, y: 0 },
      parameters: { x: 0, y: 0, z: 0, representation: 'xyz' },
    })
    raw.graph.connections = [{
      id: 'bad-type', source: 'cube-1', sourceOutput: 'geometry', target: 'translate-1', targetInput: 'x',
    }]
    expect(() => parseScadletProject(raw)).toThrow('incompatible socket types: geometry output cannot connect to number input')
  })

  it('also rejects Geometry -> Add A through the Milestone 7 catalog ports', () => {
    const raw = validProject()
    raw.graph.nodes.push({ id: 'add-1', type: 'add', position: { x: 0, y: 0 }, parameters: { a: 1, b: 2 } })
    raw.graph.connections = [{ id: 'bad-add', source: 'cube-1', sourceOutput: 'geometry', target: 'add-1', targetInput: 'a' }]
    expect(() => parseScadletProject(raw)).toThrow('incompatible socket types: geometry output cannot connect to number input')
  })

  it('rejects a duplicate connection id', () => {
    const raw = validProject()
    raw.graph.connections.push({ ...raw.graph.connections[0] })
    expect(() => parseScadletProject(raw)).toThrow('Duplicate connection id: "c1"')
  })

  it('rejects a malformed v6 node dataflow cycle while preserving permitted definition recursion as a separate concept', () => {
    const fixture = JSON.parse(readFileSync(fileURLToPath(new URL('./fixtures/dataflow-cycle-v6.scadlet', import.meta.url)), 'utf8'))
    expect(() => parseScadletProject(fixture)).toThrow('Main graph contains a node dataflow cycle at connection "right-left"')
    expect(() => parseScadletProject(fixture)).toThrow('Function and Module definition recursion is allowed')
  })

  it('continues to accept direct and mutual Function/Module definition recursion', () => {
    for (const path of [
      '../../docs/examples/recursive-functions-v6.scadlet',
      '../../docs/examples/recursive-modules-v6.scadlet',
    ]) {
      const fixture = JSON.parse(readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8'))
      expect(() => parseScadletProject(fixture)).not.toThrow()
    }
  })

  it('validates Compare and Conditional dynamic socket metadata', () => {
    const raw = createEmptyProject('Conditional') as any
    raw.graph.nodes = [
      { id: 'number', type: 'number', position: { x: 0, y: 0 }, parameters: { value: 1, name: 'n' } },
      { id: 'boolean', type: 'boolean', position: { x: 0, y: 0 }, parameters: { value: true, name: 'b' } },
      { id: 'conditional', type: 'conditional', position: { x: 0, y: 0 }, parameters: { valueType: 'number' } },
    ]
    raw.graph.connections = [
      { id: 'condition', source: 'boolean', sourceOutput: 'value', target: 'conditional', targetInput: 'condition' },
      { id: 'true', source: 'number', sourceOutput: 'value', target: 'conditional', targetInput: 'true' },
      { id: 'false', source: 'number', sourceOutput: 'value', target: 'conditional', targetInput: 'false' },
    ]
    expect(() => parseScadletProject(raw)).not.toThrow()
    raw.graph.nodes[2].parameters = {}
    expect(() => parseScadletProject(raw)).toThrow('no inferred value type')
  })

  it('rejects unsupported Compare operators and mismatched Conditional branches', () => {
    const raw = createEmptyProject('Compare') as any
    raw.graph.nodes = [{ id: 'compare', type: 'compare', position: { x: 0, y: 0 }, parameters: { operator: '===' } }]
    expect(() => parseScadletProject(raw)).toThrow('supported comparison operator')

    raw.graph.nodes = [
      { id: 'number', type: 'number', position: { x: 0, y: 0 }, parameters: { value: 1, name: 'n' } },
      { id: 'boolean', type: 'boolean', position: { x: 0, y: 0 }, parameters: { value: true, name: 'b' } },
      { id: 'conditional', type: 'conditional', position: { x: 0, y: 0 }, parameters: { valueType: 'number' } },
    ]
    raw.graph.connections = [{ id: 'bad', source: 'boolean', sourceOutput: 'value', target: 'conditional', targetInput: 'true' }]
    expect(() => parseScadletProject(raw)).toThrow('incompatible socket types: boolean output cannot connect to number input')
  })

  it('validates Geometry If ports in Main but rejects it from Function graphs', () => {
    const raw = createEmptyProject('If') as any
    raw.graph.nodes = [
      { id: 'condition', type: 'boolean', position: { x: 0, y: 0 }, parameters: { value: true, name: 'condition' } },
      { id: 'then', type: 'cube', position: { x: 0, y: 0 }, parameters: { sizeRepresentation: 'scalar', size: 1 } },
      { id: 'if', type: 'if', position: { x: 0, y: 0 }, parameters: {} },
    ]
    raw.graph.connections = [
      { id: 'condition', source: 'condition', sourceOutput: 'value', target: 'if', targetInput: 'condition' },
      { id: 'then', source: 'then', sourceOutput: 'geometry', target: 'if', targetInput: 'then' },
    ]
    expect(() => parseScadletProject(raw)).not.toThrow()

    raw.definitions = [{
      id: 'function', kind: 'function', name: 'value', interface: { inputs: 'inputs', output: 'output' }, parameters: [],
      graph: { nodes: [
        { id: 'inputs', type: 'function-inputs', position: { x: 0, y: 0 }, parameters: {} },
        { id: 'if-in-function', type: 'if', position: { x: 100, y: 0 }, parameters: {} },
        { id: 'output', type: 'function-output', position: { x: 200, y: 0 }, parameters: {} },
      ], connections: [] },
    }]
    expect(() => parseScadletProject(raw)).toThrow('not a supported node type inside a Function definition')
  })
})

describe('parseScadletProject: editor/viewport', () => {
  it('rejects a missing/invalid viewport', () => {
    const raw = { ...validProject(), editor: {} }
    expect(() => parseScadletProject(raw)).toThrow('editor.viewport')
  })

  it('rejects a non-finite viewport field', () => {
    const raw = validProject()
    raw.editor.viewport.zoom = Number.POSITIVE_INFINITY
    expect(() => parseScadletProject(raw)).toThrow('editor.viewport.zoom')
  })
})

describe('parseScadletProject: viewer/camera', () => {
  it('rejects a missing/invalid camera', () => {
    const raw = { ...validProject(), viewer: {} }
    expect(() => parseScadletProject(raw)).toThrow('viewer.camera')
  })

  it('rejects a camera position that is not a 3-tuple', () => {
    const raw = validProject()
    ;(raw.viewer.camera as Record<string, unknown>).position = [1, 2]
    expect(() => parseScadletProject(raw)).toThrow('viewer.camera.position')
  })

  it('rejects a non-finite camera target component', () => {
    const raw = validProject()
    raw.viewer.camera.target = [0, Number.NaN, 0]
    expect(() => parseScadletProject(raw)).toThrow('viewer.camera.target[1]')
  })
})

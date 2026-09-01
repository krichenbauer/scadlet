import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { findCatalogEntry, NODE_CATALOG } from '../editor/node-catalog'
import { parseScadletProject } from './validate'

const EXAMPLES_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../docs/examples')

const EXAMPLE_FIXTURES = ['empty-project.scadlet', 'sphere-fn50.scadlet', 'cube-sphere-union-translate.scadlet', 'v2-empty-cube.scadlet']

function readExample(filename: string): unknown {
  return JSON.parse(readFileSync(join(EXAMPLES_DIR, filename), 'utf-8'))
}

/**
 * Guards `docs/scadlet-format.md` against drifting from the actual
 * implementation: every complete example embedded in that document is
 * also kept as a real `.scadlet` fixture under `docs/examples/` and
 * parsed here through the real `parseScadletProject()` - not a hand-
 * rolled or merely-assumed-valid copy. If a future persistence change
 * breaks one of these examples, this test (not just prose review) fails.
 */
describe('docs/scadlet-format.md examples stay valid', () => {
  it.each(EXAMPLE_FIXTURES)('%s parses successfully through the real loader', (filename) => {
    expect(() => parseScadletProject(readExample(filename))).not.toThrow()
  })

  it('empty-project.scadlet has no nodes or connections', () => {
    const project = parseScadletProject(readExample('empty-project.scadlet'))
    expect(project.graph.nodes).toEqual([])
    expect(project.graph.connections).toEqual([])
  })

  it('v2-empty-cube.scadlet keeps an omitted Cube signature', () => {
    const project = parseScadletProject(readExample('v2-empty-cube.scadlet'))
    expect(project.version).toBe(2)
    expect(project.graph.nodes[0]?.parameters).toEqual({})
  })

  it('sphere-fn50.scadlet round-trips a Sphere with $fn=50', () => {
    const project = parseScadletProject(readExample('sphere-fn50.scadlet'))
    expect(project.graph.nodes[0]).toMatchObject({
      type: 'sphere',
      parameters: { mode: 'radius', r: 25, d: 50, fn: 50 },
    })
  })

  it('cube-sphere-union-translate.scadlet has valid topology, ports, and a pinned node', () => {
    const project = parseScadletProject(readExample('cube-sphere-union-translate.scadlet'))
    expect(project.graph.nodes).toHaveLength(4)
    expect(project.graph.connections).toHaveLength(3)
    expect(project.graph.nodes.find((n) => n.id === 'translate-1')?.pinned).toBe(true)
  })
})

/** Keeps the node-type list this document claims to cover in sync with the actual catalog. */
describe('docs/scadlet-format.md documented node types stay in sync with the catalog', () => {
  const documentedTypes = [
    'cube',
    'cylinder',
    'sphere',
    'translate',
    'rotate',
    'scale',
    'difference',
    'union',
    'intersection',
    'number',
    'boolean',
    'vector3',
    'add',
    'subtract',
    'multiply',
    'divide',
  ]

  it('documents exactly the node types the catalog currently implements', () => {
    const catalogTypes = NODE_CATALOG.map((entry) => entry.type).sort()
    expect(documentedTypes.slice().sort()).toEqual(catalogTypes)
  })

  it('every documented type resolves to a real catalog entry with declared ports', () => {
    for (const type of documentedTypes) {
      const entry = findCatalogEntry(type)
      expect(entry, `missing catalog entry for documented type "${type}"`).toBeDefined()
      expect(Array.isArray(entry?.inputs)).toBe(true)
      expect(Array.isArray(entry?.outputs)).toBe(true)
    }
  })
})

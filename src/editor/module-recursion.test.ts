import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { NodeEditor } from 'rete'
import { DataflowEngine } from 'rete-engine'
import { describe, expect, it } from 'vitest'

import { DefinitionRegistry } from './definitions'
import { evaluateOpenSCAD } from './evaluate'
import type { Schemes } from './schemes'
import { restoreProject } from '../persistence/restore'
import { parseScadletProject } from '../persistence/validate'

const recursiveModulesFixture = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../docs/examples/recursive-modules-v6.scadlet'), 'utf8'))

async function evaluateFixture(raw: unknown): Promise<string> {
  const project = parseScadletProject(raw)
  const editor = new NodeEditor<Schemes>()
  const engine = new DataflowEngine<Schemes>((node) => ({ inputs: () => Object.keys(node.inputs), outputs: () => Object.keys(node.outputs) }))
  editor.use(engine)
  const definitions = new DefinitionRegistry()
  await restoreProject(project, {
    editor,
    creationContext: { onControlsChanged: () => {}, getModuleDefinition: (id) => definitions.get(id) },
    setNodePosition: () => {}, clearDefinitions: () => definitions.clear(), registerDefinition: (item) => definitions.add(item),
    assignNodeToDefinition: (definitionId, nodeId) => definitions.assignNode(definitionId, nodeId),
  })
  return evaluateOpenSCAD(editor, engine, undefined, definitions)
}

describe('recursive Module source generation', () => {
  it('generates a direct terminating recursion through Geometry If, Union, Translate, children, and a value Function Call', async () => {
    const source = await evaluateFixture(recursiveModulesFixture)
    expect(source.indexOf('function previous(n = 1)')).toBeLessThan(source.indexOf('module stack(n = 1)'))
    expect(source).toContain('module stack(n = 1) {')
    expect(source).toContain('if ((n <= 1)) {')
    expect(source).toContain('union() {')
    expect(source).toContain('translate([0, 0, 5]) {')
    expect(source).toContain('stack(n = previous(n = n)) {')
    expect(source).toContain('children(1);')
    expect(source).toContain('stack(n = 4) {\n  union() {}')
  })

  it('emits a mutual Module SCC in stable project order independent of connection order', async () => {
    const source = await evaluateFixture(recursiveModulesFixture)
    expect(source.indexOf('module pong(n = 0)')).toBeLessThan(source.indexOf('module ping(n = 0)'))
    expect(source).toContain('ping(n = previous(n = n));')
    expect(source).toContain('pong(n = previous(n = n));')

    const reversed = structuredClone(recursiveModulesFixture)
    for (const definition of reversed.definitions) definition.graph.connections.reverse()
    reversed.graph.connections.reverse()
    expect(await evaluateFixture(reversed)).toBe(source)
  })
})

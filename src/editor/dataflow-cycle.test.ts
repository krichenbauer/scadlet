import { ClassicPreset, NodeEditor } from 'rete'
import { describe, expect, it } from 'vitest'

import { wouldCreateDataflowCycle } from './dataflow-cycle'
import { DefinitionRegistry, bindDefinitionRegistry } from './definitions'
import { attachSocketCompatibilityGuard } from './editor'
import type { Schemes } from './schemes'
import { geometrySocket, numberSocket } from './sockets'

class ValuePassNode extends ClassicPreset.Node {
  constructor() {
    super('Value pass')
    this.addInput('input', new ClassicPreset.Input(numberSocket, 'Input'))
    this.addOutput('value', new ClassicPreset.Output(numberSocket, 'Value'))
  }
}

class GeometryPassNode extends ClassicPreset.Node {
  constructor() {
    super('Geometry pass')
    this.addInput('geometry', new ClassicPreset.Input(geometrySocket, 'Geometry'))
    this.addOutput('geometry', new ClassicPreset.Output(geometrySocket, 'Geometry'))
  }
}

function connection(
  source: ClassicPreset.Node,
  sourceOutput: string,
  target: ClassicPreset.Node,
  targetInput: string,
): Schemes['Connection'] {
  return new ClassicPreset.Connection(source, sourceOutput, target, targetInput) as Schemes['Connection']
}

async function add(editor: NodeEditor<Schemes>, ...nodes: ClassicPreset.Node[]): Promise<void> {
  for (const node of nodes) await editor.addNode(node as Schemes['Node'])
}

describe('node dataflow cycle detection', () => {
  it('recognizes direct, indirect, and disconnected structural cycles without following definition dependencies', () => {
    expect(wouldCreateDataflowCycle([], { source: 'a', target: 'a' })).toBe(true)
    expect(wouldCreateDataflowCycle([{ source: 'a', target: 'b' }], { source: 'b', target: 'a' })).toBe(true)
    expect(wouldCreateDataflowCycle([
      { source: 'a', target: 'b' }, { source: 'b', target: 'c' },
    ], { source: 'c', target: 'a' })).toBe(true)
    expect(wouldCreateDataflowCycle([{ source: 'a', target: 'b' }], { source: 'b', target: 'c' })).toBe(false)
  })

  it('rejects a direct self-cycle without mutating the graph or emitting dirty-style connection signals', async () => {
    const editor = new NodeEditor<Schemes>()
    const rejected = [] as string[]
    const signals = [] as string[]
    attachSocketCompatibilityGuard(editor, () => rejected.push('cycle'))
    editor.addPipe((context) => { signals.push(context.type); return context })
    const node = new ValuePassNode()
    await add(editor, node)

    expect(await editor.addConnection(connection(node, 'value', node, 'input'))).toBe(false)
    expect(editor.getConnections()).toEqual([])
    expect(rejected).toEqual(['cycle'])
    expect(signals).not.toContain('connectioncreated')
  })

  it('rejects two-node and longer indirect Value cycles, but permits an acyclic chain', async () => {
    const editor = new NodeEditor<Schemes>()
    attachSocketCompatibilityGuard(editor)
    const [a, b, c] = [new ValuePassNode(), new ValuePassNode(), new ValuePassNode()]
    await add(editor, a, b, c)

    expect(await editor.addConnection(connection(a, 'value', b, 'input'))).toBe(true)
    expect(await editor.addConnection(connection(b, 'value', a, 'input'))).toBe(false)
    expect(await editor.addConnection(connection(b, 'value', c, 'input'))).toBe(true)
    expect(await editor.addConnection(connection(c, 'value', a, 'input'))).toBe(false)
    expect(editor.getConnections()).toHaveLength(2)
  })

  it('rejects Geometry cycles as structural dataflow too', async () => {
    const editor = new NodeEditor<Schemes>()
    attachSocketCompatibilityGuard(editor)
    const [a, b] = [new GeometryPassNode(), new GeometryPassNode()]
    await add(editor, a, b)

    expect(await editor.addConnection(connection(a, 'geometry', b, 'geometry'))).toBe(true)
    expect(await editor.addConnection(connection(b, 'geometry', a, 'geometry'))).toBe(false)
    expect(editor.getConnections()).toHaveLength(1)
  })

  it.each([
    ['Main', null],
    ['Module', 'module-scope'],
    ['Function', 'function-scope'],
  ] as const)('enforces the same rule in %s scope', async (_label, scope) => {
    const editor = new NodeEditor<Schemes>()
    const definitions = new DefinitionRegistry()
    bindDefinitionRegistry(editor, definitions)
    if (scope) {
      definitions.add({
        id: scope,
        kind: scope === 'function-scope' ? 'function' : 'module',
        name: scope === 'function-scope' ? 'value_loop' : 'shape_loop',
        inputsNodeId: `${scope}-inputs`, outputNodeId: `${scope}-output`, parameters: [],
      })
    }
    attachSocketCompatibilityGuard(editor)
    const [a, b] = [new ValuePassNode(), new ValuePassNode()]
    await add(editor, a, b)
    if (scope) definitions.setNodeScopes([a.id, b.id], scope)

    expect(await editor.addConnection(connection(a, 'value', b, 'input'))).toBe(true)
    expect(await editor.addConnection(connection(b, 'value', a, 'input'))).toBe(false)
  })
})

import { ClassicPreset, NodeEditor } from 'rete'
import { describe, expect, it } from 'vitest'

import { CubeNode } from '../editor/nodes/cube-node'
import { DifferenceNode } from '../editor/nodes/difference-node'
import { SphereNode } from '../editor/nodes/sphere-node'
import { TranslateNode } from '../editor/nodes/translate-node'
import type { Schemes } from '../editor/schemes'
import { serializeProject } from './serialize'

function connection(
  source: ClassicPreset.Node,
  sourceOutput: string,
  target: ClassicPreset.Node,
  targetInput: string,
) {
  return new ClassicPreset.Connection<ClassicPreset.Node, ClassicPreset.Node>(
    source,
    sourceOutput,
    target,
    targetInput,
  )
}

describe('serializeProject', () => {
  it('captures format/version/metadata/empty graph for an empty editor', () => {
    const editor = new NodeEditor<Schemes>()
    const project = serializeProject({
      editor,
      metadata: { name: 'Empty' },
      getNodePosition: () => ({ x: 0, y: 0 }),
      viewport: { x: 0, y: 0, k: 1 },
      viewerCamera: { position: [1, 2, 3], target: [0, 0, 0] },
      now: () => '2026-01-01T00:00:00.000Z',
    })

    expect(project.format).toBe('scadlet')
    expect(project.version).toBe(1)
    expect(project.metadata).toEqual({ name: 'Empty', updatedAt: '2026-01-01T00:00:00.000Z' })
    expect(project.graph).toEqual({ nodes: [], connections: [] })
  })

  it('serializes node id/type/position/parameters', async () => {
    const editor = new NodeEditor<Schemes>()
    const cube = new CubeNode({ sizeX: 1, sizeY: 2, sizeZ: 3, center: true })
    await editor.addNode(cube)

    const project = serializeProject({
      editor,
      metadata: { name: 'X' },
      getNodePosition: (id) => (id === cube.id ? { x: 42, y: -17 } : { x: 0, y: 0 }),
      viewport: { x: 0, y: 0, k: 1 },
      viewerCamera: { position: [0, 0, 0], target: [0, 0, 0] },
    })

    expect(project.graph.nodes).toEqual([
      { id: cube.id, type: 'cube', position: { x: 42, y: -17 }, parameters: { sizeX: 1, sizeY: 2, sizeZ: 3, center: true } },
    ])
  })

  it('omits "pinned" for an unpinned node and includes it (true) for a pinned one', async () => {
    const editor = new NodeEditor<Schemes>()
    const a = new CubeNode()
    const b = new SphereNode()
    await editor.addNode(a)
    await editor.addNode(b)

    const project = serializeProject({
      editor,
      metadata: { name: 'X' },
      getNodePosition: () => ({ x: 0, y: 0 }),
      isPinned: (id) => id === b.id,
      viewport: { x: 0, y: 0, k: 1 },
      viewerCamera: { position: [0, 0, 0], target: [0, 0, 0] },
    })

    const dtoA = project.graph.nodes.find((n) => n.id === a.id)!
    const dtoB = project.graph.nodes.find((n) => n.id === b.id)!
    expect(dtoA.pinned).toBeUndefined()
    expect(dtoB.pinned).toBe(true)
  })

  it('serializes connections with concrete source/target ports', async () => {
    const editor = new NodeEditor<Schemes>()
    const cube = new CubeNode()
    const translate = new TranslateNode()
    await editor.addNode(cube)
    await editor.addNode(translate)
    await editor.addConnection(connection(cube, 'geometry', translate, 'geometry'))

    const project = serializeProject({
      editor,
      metadata: { name: 'X' },
      getNodePosition: () => ({ x: 0, y: 0 }),
      viewport: { x: 0, y: 0, k: 1 },
      viewerCamera: { position: [0, 0, 0], target: [0, 0, 0] },
    })

    expect(project.graph.connections).toEqual([
      { id: expect.any(String), source: cube.id, sourceOutput: 'geometry', target: translate.id, targetInput: 'geometry' },
    ])
  })

  it('preserves asymmetric port names for Difference', async () => {
    const editor = new NodeEditor<Schemes>()
    const base = new CubeNode()
    const subtract = new SphereNode()
    const diff = new DifferenceNode()
    await editor.addNode(base)
    await editor.addNode(subtract)
    await editor.addNode(diff)
    await editor.addConnection(connection(base, 'geometry', diff, 'base'))
    await editor.addConnection(connection(subtract, 'geometry', diff, 'subtract'))

    const project = serializeProject({
      editor,
      metadata: { name: 'X' },
      getNodePosition: () => ({ x: 0, y: 0 }),
      viewport: { x: 0, y: 0, k: 1 },
      viewerCamera: { position: [0, 0, 0], target: [0, 0, 0] },
    })

    const ports = project.graph.connections.map((c) => c.targetInput).sort()
    expect(ports).toEqual(['base', 'subtract'])
  })

  it('converts viewport transform.k to editor.viewport.zoom', () => {
    const editor = new NodeEditor<Schemes>()
    const project = serializeProject({
      editor,
      metadata: { name: 'X' },
      getNodePosition: () => ({ x: 0, y: 0 }),
      viewport: { x: 12, y: -8, k: 1.4 },
      viewerCamera: { position: [0, 0, 0], target: [0, 0, 0] },
    })
    expect(project.editor.viewport).toEqual({ x: 12, y: -8, zoom: 1.4 })
  })

  it('preserves node/connection ordering (matches NodeEditor iteration order)', async () => {
    const editor = new NodeEditor<Schemes>()
    const a = new CubeNode()
    const b = new SphereNode()
    const c = new TranslateNode()
    await editor.addNode(a)
    await editor.addNode(b)
    await editor.addNode(c)

    const project = serializeProject({
      editor,
      metadata: { name: 'X' },
      getNodePosition: () => ({ x: 0, y: 0 }),
      viewport: { x: 0, y: 0, k: 1 },
      viewerCamera: { position: [0, 0, 0], target: [0, 0, 0] },
    })

    expect(project.graph.nodes.map((n) => n.id)).toEqual([a.id, b.id, c.id])
  })
})

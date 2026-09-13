import { NodeEditor } from 'rete'
import { DataflowEngine } from 'rete-engine'
import { describe, expect, it, vi } from 'vitest'

import { evaluateOpenSCAD } from '../editor/evaluate'
import { CubeNode } from '../editor/nodes/cube-node'
import type { Schemes } from '../editor/schemes'
import { createEmptyProject } from './project'
import { clearGraph, restoreProject } from './restore'
import { parseScadletProject } from './validate'

function createGraph() {
  const editor = new NodeEditor<Schemes>()
  const engine = new DataflowEngine<Schemes>((node) => ({
    inputs: () => Object.keys(node.inputs),
    outputs: () => Object.keys(node.outputs),
  }))
  editor.use(engine)
  return { editor, engine }
}

const noopContext = { onControlsChanged: () => {} }

describe('clearGraph', () => {
  it('removes every node and connection, one at a time', async () => {
    const { editor } = createGraph()
    const a = new CubeNode()
    const b = new CubeNode()
    await editor.addNode(a)
    await editor.addNode(b)

    await clearGraph(editor)

    expect(editor.getNodes()).toEqual([])
    expect(editor.getConnections()).toEqual([])
  })
})

describe('restoreProject', () => {
  it('restores an empty project into an editor that already has nodes', async () => {
    const { editor } = createGraph()
    await editor.addNode(new CubeNode())

    await restoreProject(parseScadletProject(createEmptyProject()), {
      editor,
      creationContext: noopContext,
      setNodePosition: () => {},
    })

    expect(editor.getNodes()).toEqual([])
  })

  it('never starts restoring a malformed node-dataflow cycle over a valid graph', async () => {
    const { editor } = createGraph()
    const existing = new CubeNode(); existing.id = 'existing-cube'
    await editor.addNode(existing)
    const malformed = {
      ...createEmptyProject('Malformed'),
      graph: {
        nodes: [
          { id: 'left', type: 'arithmetic', position: { x: 0, y: 0 }, parameters: { operation: 'addition', a: 0, b: 1 } },
          { id: 'right', type: 'arithmetic', position: { x: 200, y: 0 }, parameters: { operation: 'addition', a: 0, b: 1 } },
        ],
        connections: [
          { id: 'left-right', source: 'left', sourceOutput: 'value', target: 'right', targetInput: 'a' },
          { id: 'right-left', source: 'right', sourceOutput: 'value', target: 'left', targetInput: 'a' },
        ],
      },
    }

    expect(() => parseScadletProject(malformed)).toThrow('node dataflow cycle')
    expect(editor.getNodes().map((node) => node.id)).toEqual(['existing-cube'])
    expect(editor.getConnections()).toEqual([])
  })

  it('restores nodes with their exact persisted ids and parameters', async () => {
    const { editor } = createGraph()
    const project = parseScadletProject({
      format: 'scadlet',
      version: 1,
      metadata: { name: 'X' },
      graph: {
        nodes: [
          {
            id: 'my-cube-id',
            type: 'cube',
            position: { x: 12, y: 34 },
            parameters: { sizeX: 5, sizeY: 6, sizeZ: 7, center: true },
          },
        ],
        connections: [],
      },
      editor: { viewport: { x: 0, y: 0, zoom: 1 } },
      viewer: { camera: { position: [0, 0, 0], target: [0, 0, 0] } },
    })

    const positions: Record<string, { x: number; y: number }> = {}
    await restoreProject(project, {
      editor,
      creationContext: noopContext,
      setNodePosition: (id, position) => {
        positions[id] = position
      },
    })

    const [node] = editor.getNodes()
    expect(node.id).toBe('my-cube-id')
    expect(positions['my-cube-id']).toEqual({ x: 12, y: 34 })
    expect((node as CubeNode).getPersistedParams()).toMatchObject({ size: { x: 5, y: 6, z: 7 }, sizeRepresentation: 'xyz', center: true })
  })

  it('restores connections addressing the exact persisted node/port ids, evaluating to the same OpenSCAD', async () => {
    const { editor, engine } = createGraph()
    const project = parseScadletProject({
      format: 'scadlet',
      version: 1,
      metadata: { name: 'X' },
      graph: {
        nodes: [
          { id: 'cube-1', type: 'cube', position: { x: 0, y: 0 }, parameters: { sizeX: 10, sizeY: 10, sizeZ: 10, center: false } },
          { id: 'sphere-1', type: 'sphere', position: { x: 0, y: 0 }, parameters: { mode: 'radius', r: 5, d: 10 } },
          { id: 'union-1', type: 'union', position: { x: 0, y: 0 }, parameters: {} },
        ],
        connections: [
          { id: 'c1', source: 'cube-1', sourceOutput: 'geometry', target: 'union-1', targetInput: 'a' },
          { id: 'c2', source: 'sphere-1', sourceOutput: 'geometry', target: 'union-1', targetInput: 'b' },
        ],
      },
      editor: { viewport: { x: 0, y: 0, zoom: 1 } },
      viewer: { camera: { position: [0, 0, 0], target: [0, 0, 0] } },
    })

    await restoreProject(project, { editor, creationContext: noopContext, setNodePosition: () => {} })

    expect(editor.getConnections()).toHaveLength(2)
    const source = await evaluateOpenSCAD(editor, engine)
    expect(source).toBe('union() {\n    cube(10);\n    sphere(r=5);\n}')
  })

  it('restores collapse state via setCollapsed only for collapsed nodes', async () => {
    const { editor } = createGraph()
    const project = parseScadletProject({
      format: 'scadlet',
      version: 1,
      metadata: { name: 'X' },
      graph: {
        nodes: [
          { id: 'a', type: 'cube', position: { x: 0, y: 0 }, parameters: { sizeX: 1, sizeY: 1, sizeZ: 1, center: false }, collapsed: true },
          { id: 'b', type: 'cube', position: { x: 0, y: 0 }, parameters: { sizeX: 1, sizeY: 1, sizeZ: 1, center: false } },
        ],
        connections: [],
      },
      editor: { viewport: { x: 0, y: 0, zoom: 1 } },
      viewer: { camera: { position: [0, 0, 0], target: [0, 0, 0] } },
    })

    const setCollapsed = vi.fn()
    await restoreProject(project, { editor, creationContext: noopContext, setNodePosition: () => {}, setCollapsed })

    expect(setCollapsed).toHaveBeenCalledExactlyOnceWith('a', true)
  })

  it('restores viewport and viewer camera via the injected setters', async () => {
    const { editor } = createGraph()
    const project = parseScadletProject({
      ...createEmptyProject('X'),
      editor: { viewport: { x: 12, y: -8, zoom: 1.4 } },
      viewer: { camera: { position: [1, 2, 3], target: [4, 5, 6] } },
    })

    const setViewport = vi.fn()
    const setViewerCamera = vi.fn()
    await restoreProject(project, {
      editor,
      creationContext: noopContext,
      setNodePosition: () => {},
      setViewport,
      setViewerCamera,
    })

    expect(setViewport).toHaveBeenCalledExactlyOnceWith({ x: 12, y: -8, k: 1.4 })
    expect(setViewerCamera).toHaveBeenCalledExactlyOnceWith({ position: [1, 2, 3], target: [4, 5, 6] })
  })

  it('never notifies dirty via the parameter-control mechanism, even for nodes with non-default parameters', async () => {
    const { editor } = createGraph()
    const notifyDirty = vi.fn()
    const project = parseScadletProject({
      format: 'scadlet',
      version: 1,
      metadata: { name: 'X' },
      graph: {
        nodes: [
          {
            id: 'cylinder-1',
            type: 'cylinder',
            position: { x: 0, y: 0 },
            parameters: { h: 20, mode: 'tapered', r: 1, d: 2, r1: 8, r2: 2, center: true, fn: 50 },
          },
        ],
        connections: [],
      },
      editor: { viewport: { x: 0, y: 0, zoom: 1 } },
      viewer: { camera: { position: [0, 0, 0], target: [0, 0, 0] } },
    })

    await restoreProject(project, {
      editor,
      creationContext: { onControlsChanged: () => {}, notifyDirty },
      setNodePosition: () => {},
    })

    expect(notifyDirty).not.toHaveBeenCalled()
  })

  it('rolls back to the previously valid project when applying a prepared replacement fails', async () => {
    const { editor } = createGraph()
    const original = parseScadletProject({
      ...createEmptyProject('Original'),
      graph: {
        nodes: [{ id: 'original-cube', type: 'cube', position: { x: 1, y: 2 }, parameters: { size: 4 } }],
        connections: [],
      },
    })
    const replacement = parseScadletProject({
      ...createEmptyProject('Replacement'),
      graph: {
        nodes: [{ id: 'replacement-cube', type: 'cube', position: { x: 3, y: 4 }, parameters: { size: 9 } }],
        connections: [],
      },
    })
    await restoreProject(original, { editor, creationContext: noopContext, setNodePosition: () => {} })

    let failReplacementPosition = true
    await expect(restoreProject(replacement, {
      editor,
      creationContext: noopContext,
      rollbackProject: original,
      setNodePosition: (id) => {
        if (id === 'replacement-cube' && failReplacementPosition) {
          failReplacementPosition = false
          throw new Error('simulated position failure')
        }
      },
    })).rejects.toThrow('simulated position failure')

    expect(editor.getNodes().map((node) => node.id)).toEqual(['original-cube'])
    expect(editor.getConnections()).toEqual([])
  })
})

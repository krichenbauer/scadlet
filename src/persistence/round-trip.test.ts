import { ClassicPreset, NodeEditor } from 'rete'
import { DataflowEngine } from 'rete-engine'
import { describe, expect, it } from 'vitest'

import { evaluateOpenSCAD } from '../editor/evaluate'
import { CubeNode } from '../editor/nodes/cube-node'
import { CylinderNode } from '../editor/nodes/cylinder-node'
import { DifferenceNode } from '../editor/nodes/difference-node'
import { IntersectionNode } from '../editor/nodes/intersection-node'
import { RotateNode } from '../editor/nodes/rotate-node'
import { ScaleNode } from '../editor/nodes/scale-node'
import { SphereNode } from '../editor/nodes/sphere-node'
import { TranslateNode } from '../editor/nodes/translate-node'
import { UnionNode } from '../editor/nodes/union-node'
import type { Schemes } from '../editor/schemes'
import { serializeProject } from './serialize'
import { restoreProject } from './restore'
import { parseScadletProject } from './validate'

const noopContext = { onControlsChanged: () => {} }

function createGraph() {
  const editor = new NodeEditor<Schemes>()
  const engine = new DataflowEngine<Schemes>((node) => ({
    inputs: () => Object.keys(node.inputs),
    outputs: () => Object.keys(node.outputs),
  }))
  editor.use(engine)
  return { editor, engine }
}

function connect(source: ClassicPreset.Node, sourceOutput: string, target: ClassicPreset.Node, targetInput: string) {
  return new ClassicPreset.Connection<ClassicPreset.Node, ClassicPreset.Node>(source, sourceOutput, target, targetInput)
}

interface FakePositions {
  [nodeId: string]: { x: number; y: number }
}

/**
 * Simulates a complete save → `.scadlet` JSON (through `JSON.stringify`/
 * `JSON.parse`, not just in-memory objects) → open round trip: serializes
 * `source`, round-trips it through JSON text, fully re-validates it
 * (`parseScadletProject`, exactly like a real opened file), and restores
 * it into a fresh `target` editor.
 */
async function roundTrip(
  source: { editor: NodeEditor<Schemes>; positions: FakePositions; pinned?: Set<string> },
  target: NodeEditor<Schemes>,
  extra?: { viewport?: { x: number; y: number; k: number }; camera?: { position: [number, number, number]; target: [number, number, number] } },
) {
  const project = serializeProject({
    editor: source.editor,
    metadata: { name: 'Round Trip' },
    getNodePosition: (id) => source.positions[id] ?? { x: 0, y: 0 },
    isPinned: (id) => source.pinned?.has(id) ?? false,
    viewport: extra?.viewport ?? { x: 0, y: 0, k: 1 },
    viewerCamera: extra?.camera ?? { position: [0, 0, 0], target: [0, 0, 0] },
  })

  const text = JSON.stringify(project, null, 2)
  const reparsed = parseScadletProject(JSON.parse(text))

  const restoredPositions: FakePositions = {}
  const restoredPinned = new Set<string>()
  await restoreProject(reparsed, {
    editor: target,
    creationContext: noopContext,
    setNodePosition: (id, position) => {
      restoredPositions[id] = position
    },
    setPinned: (id, pinned) => {
      if (pinned) restoredPinned.add(id)
    },
  })

  return { project: reparsed, restoredPositions, restoredPinned }
}

describe('per-node semantic round trip (serialize -> restore -> evaluate)', () => {
  it('Cube with non-default dimensions and center', async () => {
    const { editor: src } = createGraph()
    await src.addNode(new CubeNode({ sizeX: 3, sizeY: 4, sizeZ: 5, center: true }))

    const { editor: dst, engine } = createGraph()
    await roundTrip({ editor: src, positions: {} }, dst)

    expect(await evaluateOpenSCAD(dst, engine)).toBe('cube([3, 4, 5], center=true);')
  })

  it('Cylinder in radius mode with $fn enabled', async () => {
    const { editor: src } = createGraph()
    await src.addNode(new CylinderNode({ mode: 'radius', r: 8, fn: 24 }))

    const { editor: dst, engine } = createGraph()
    await roundTrip({ editor: src, positions: {} }, dst)

    expect(await evaluateOpenSCAD(dst, engine)).toBe('cylinder(r=8, $fn=24);')
  })

  it('Cylinder in diameter mode', async () => {
    const { editor: src } = createGraph()
    await src.addNode(new CylinderNode({ mode: 'diameter', d: 16 }))

    const { editor: dst, engine } = createGraph()
    await roundTrip({ editor: src, positions: {} }, dst)

    expect(await evaluateOpenSCAD(dst, engine)).toBe('cylinder(d=16);')
  })

  it('Cylinder in tapered mode, center enabled, $fn disabled', async () => {
    const { editor: src } = createGraph()
    await src.addNode(new CylinderNode({ mode: 'tapered', r1: 9, r2: 1, center: true }))

    const { editor: dst, engine } = createGraph()
    await roundTrip({ editor: src, positions: {} }, dst)

    expect(await evaluateOpenSCAD(dst, engine)).toBe('cylinder(r1=9, r2=1, center=true);')
  })

  it('Sphere in diameter mode with $fn=50', async () => {
    const { editor: src } = createGraph()
    await src.addNode(new SphereNode({ mode: 'diameter', d: 20, fn: 50 }))

    const { editor: dst, engine } = createGraph()
    await roundTrip({ editor: src, positions: {} }, dst)

    expect(await evaluateOpenSCAD(dst, engine)).toBe('sphere(d=20, $fn=50);')
  })

  it('Sphere in radius mode with $fn disabled', async () => {
    const { editor: src } = createGraph()
    await src.addNode(new SphereNode({ mode: 'radius', r: 7 }))

    const { editor: dst, engine } = createGraph()
    await roundTrip({ editor: src, positions: {} }, dst)

    expect(await evaluateOpenSCAD(dst, engine)).toBe('sphere(r=7);')
  })

  it('Translate with positive/negative/fractional values, connected to a Cube', async () => {
    const { editor: src } = createGraph()
    const cube = new CubeNode()
    const translate = new TranslateNode({ x: 10, y: -5, z: 2.5 })
    await src.addNode(cube)
    await src.addNode(translate)
    await src.addConnection(connect(cube, 'geometry', translate, 'geometry'))

    const { editor: dst, engine } = createGraph()
    await roundTrip({ editor: src, positions: {} }, dst)

    expect(await evaluateOpenSCAD(dst, engine)).toBe('translate([10, -5, 2.5]) {\n    cube(10);\n}')
  })

  it('Rotate with a non-default vector, connected to a Sphere', async () => {
    const { editor: src } = createGraph()
    const sphere = new SphereNode()
    const rotate = new RotateNode({ x: 0, y: 90, z: -45 })
    await src.addNode(sphere)
    await src.addNode(rotate)
    await src.addConnection(connect(sphere, 'geometry', rotate, 'geometry'))

    const { editor: dst, engine } = createGraph()
    await roundTrip({ editor: src, positions: {} }, dst)

    expect(await evaluateOpenSCAD(dst, engine)).toBe('rotate([0, 90, -45]) {\n    sphere(r=5);\n}')
  })

  it('Scale with non-uniform fractional values, connected to a Cube', async () => {
    const { editor: src } = createGraph()
    const cube = new CubeNode()
    const scale = new ScaleNode({ x: 2, y: 0.5, z: 1.25 })
    await src.addNode(cube)
    await src.addNode(scale)
    await src.addConnection(connect(cube, 'geometry', scale, 'geometry'))

    const { editor: dst, engine } = createGraph()
    await roundTrip({ editor: src, positions: {} }, dst)

    expect(await evaluateOpenSCAD(dst, engine)).toBe('scale([2, 0.5, 1.25]) {\n    cube(10);\n}')
  })

  it("Difference's base/subtract port identity survives restoration", async () => {
    const { editor: src } = createGraph()
    const base = new CubeNode()
    const subtract = new SphereNode()
    const diff = new DifferenceNode()
    await src.addNode(base)
    await src.addNode(subtract)
    await src.addNode(diff)
    await src.addConnection(connect(base, 'geometry', diff, 'base'))
    await src.addConnection(connect(subtract, 'geometry', diff, 'subtract'))

    const { editor: dst, engine } = createGraph()
    await roundTrip({ editor: src, positions: {} }, dst)

    expect(await evaluateOpenSCAD(dst, engine)).toBe('difference() {\n    cube(10);\n    sphere(r=5);\n}')
  })

  it("Union's A/B inputs survive restoration", async () => {
    const { editor: src } = createGraph()
    const a = new CubeNode()
    const b = new SphereNode()
    const union = new UnionNode()
    await src.addNode(a)
    await src.addNode(b)
    await src.addNode(union)
    await src.addConnection(connect(a, 'geometry', union, 'a'))
    await src.addConnection(connect(b, 'geometry', union, 'b'))

    const { editor: dst, engine } = createGraph()
    await roundTrip({ editor: src, positions: {} }, dst)

    expect(await evaluateOpenSCAD(dst, engine)).toBe('union() {\n    cube(10);\n    sphere(r=5);\n}')
  })

  it("Intersection's A/B inputs survive restoration", async () => {
    const { editor: src } = createGraph()
    const a = new CubeNode()
    const b = new SphereNode()
    const intersection = new IntersectionNode()
    await src.addNode(a)
    await src.addNode(b)
    await src.addNode(intersection)
    await src.addConnection(connect(a, 'geometry', intersection, 'a'))
    await src.addConnection(connect(b, 'geometry', intersection, 'b'))

    const { editor: dst, engine } = createGraph()
    await roundTrip({ editor: src, positions: {} }, dst)

    expect(await evaluateOpenSCAD(dst, engine)).toBe('intersection() {\n    cube(10);\n    sphere(r=5);\n}')
  })
})

describe('graph topology round trip', () => {
  it('a single disconnected primitive', async () => {
    const { editor: src } = createGraph()
    await src.addNode(new CubeNode())

    const { editor: dst, engine } = createGraph()
    await roundTrip({ editor: src, positions: {} }, dst)

    expect(dst.getNodes()).toHaveLength(1)
    expect(await evaluateOpenSCAD(dst, engine)).toBe('cube(10);')
  })

  it('primitive -> transform', async () => {
    const { editor: src } = createGraph()
    const cube = new CubeNode()
    const translate = new TranslateNode({ x: 1, y: 2, z: 3 })
    await src.addNode(cube)
    await src.addNode(translate)
    await src.addConnection(connect(cube, 'geometry', translate, 'geometry'))

    const { editor: dst, engine } = createGraph()
    await roundTrip({ editor: src, positions: {} }, dst)

    expect(dst.getNodes()).toHaveLength(2)
    expect(dst.getConnections()).toHaveLength(1)
    expect(await evaluateOpenSCAD(dst, engine)).toBe('translate([1, 2, 3]) {\n    cube(10);\n}')
  })

  it('nested transforms (Rotate wrapping Translate wrapping a Cube)', async () => {
    const { editor: src } = createGraph()
    const cube = new CubeNode()
    const translate = new TranslateNode({ x: 5, y: 0, z: 0 })
    const rotate = new RotateNode({ x: 0, y: 0, z: 90 })
    await src.addNode(cube)
    await src.addNode(translate)
    await src.addNode(rotate)
    await src.addConnection(connect(cube, 'geometry', translate, 'geometry'))
    await src.addConnection(connect(translate, 'geometry', rotate, 'geometry'))

    const { editor: dst, engine } = createGraph()
    await roundTrip({ editor: src, positions: {} }, dst)

    expect(await evaluateOpenSCAD(dst, engine)).toBe(
      'rotate([0, 0, 90]) {\n    translate([5, 0, 0]) {\n        cube(10);\n    }\n}',
    )
  })

  it('Boolean operation nested inside a transform', async () => {
    const { editor: src } = createGraph()
    const a = new CubeNode()
    const b = new SphereNode()
    const union = new UnionNode()
    const scale = new ScaleNode({ x: 2, y: 2, z: 2 })
    await src.addNode(a)
    await src.addNode(b)
    await src.addNode(union)
    await src.addNode(scale)
    await src.addConnection(connect(a, 'geometry', union, 'a'))
    await src.addConnection(connect(b, 'geometry', union, 'b'))
    await src.addConnection(connect(union, 'geometry', scale, 'geometry'))

    const { editor: dst, engine } = createGraph()
    await roundTrip({ editor: src, positions: {} }, dst)

    expect(await evaluateOpenSCAD(dst, engine)).toBe(
      'scale([2, 2, 2]) {\n    union() {\n        cube(10);\n        sphere(r=5);\n    }\n}',
    )
  })

  it('a transform nested inside a Boolean operation', async () => {
    const { editor: src } = createGraph()
    const cube = new CubeNode()
    const sphere = new SphereNode()
    const translate = new TranslateNode({ x: 3, y: 0, z: 0 })
    const diff = new DifferenceNode()
    await src.addNode(cube)
    await src.addNode(sphere)
    await src.addNode(translate)
    await src.addNode(diff)
    await src.addConnection(connect(cube, 'geometry', diff, 'base'))
    await src.addConnection(connect(sphere, 'geometry', translate, 'geometry'))
    await src.addConnection(connect(translate, 'geometry', diff, 'subtract'))

    const { editor: dst, engine } = createGraph()
    await roundTrip({ editor: src, positions: {} }, dst)

    expect(await evaluateOpenSCAD(dst, engine)).toBe(
      'difference() {\n    cube(10);\n    translate([3, 0, 0]) {\n        sphere(r=5);\n    }\n}',
    )
  })

  it('a larger graph using several node types', async () => {
    const { editor: src } = createGraph()
    const cube = new CubeNode()
    const sphere = new SphereNode()
    const cylinder = new CylinderNode()
    const union = new UnionNode()
    const diff = new DifferenceNode()
    const rotate = new RotateNode({ z: 30 })
    await src.addNode(cube)
    await src.addNode(sphere)
    await src.addNode(cylinder)
    await src.addNode(union)
    await src.addNode(diff)
    await src.addNode(rotate)
    await src.addConnection(connect(cube, 'geometry', union, 'a'))
    await src.addConnection(connect(sphere, 'geometry', union, 'b'))
    await src.addConnection(connect(union, 'geometry', diff, 'base'))
    await src.addConnection(connect(cylinder, 'geometry', diff, 'subtract'))
    await src.addConnection(connect(diff, 'geometry', rotate, 'geometry'))

    const { editor: dst, engine } = createGraph()
    await roundTrip({ editor: src, positions: {} }, dst)

    expect(dst.getNodes()).toHaveLength(6)
    expect(dst.getConnections()).toHaveLength(5)
    expect(await evaluateOpenSCAD(dst, engine)).toBe(
      'rotate([0, 0, 30]) {\n' +
        '    difference() {\n' +
        '        union() {\n' +
        '            cube(10);\n' +
        '            sphere(r=5);\n' +
        '        }\n' +
        '        cylinder(h=10, r=5);\n' +
        '    }\n' +
        '}',
    )
  })

  it('disconnected nodes coexisting with a connected subgraph', async () => {
    const { editor: src } = createGraph()
    const cube = new CubeNode()
    const orphanSphere = new SphereNode()
    const orphanCylinder = new CylinderNode()
    await src.addNode(cube)
    await src.addNode(orphanSphere)
    await src.addNode(orphanCylinder)

    const { editor: dst, engine } = createGraph()
    await roundTrip({ editor: src, positions: {} }, dst)

    expect(dst.getNodes()).toHaveLength(3)
    expect(dst.getConnections()).toHaveLength(0)
    const source = await evaluateOpenSCAD(dst, engine)
    expect(source).toContain('cube(10);')
    expect(source).toContain('sphere(r=5);')
    expect(source).toContain('cylinder(h=10, r=5);')
  })

  it('multiple independent connected branches', async () => {
    const { editor: src } = createGraph()
    const a1 = new CubeNode()
    const a2 = new TranslateNode({ x: 1, y: 0, z: 0 })
    const b1 = new SphereNode()
    const b2 = new ScaleNode({ x: 2, y: 2, z: 2 })
    await src.addNode(a1)
    await src.addNode(a2)
    await src.addNode(b1)
    await src.addNode(b2)
    await src.addConnection(connect(a1, 'geometry', a2, 'geometry'))
    await src.addConnection(connect(b1, 'geometry', b2, 'geometry'))

    const { editor: dst, engine } = createGraph()
    await roundTrip({ editor: src, positions: {} }, dst)

    const source = await evaluateOpenSCAD(dst, engine)
    expect(source).toContain('translate([1, 0, 0]) {\n    cube(10);\n}')
    expect(source).toContain('scale([2, 2, 2]) {\n    sphere(r=5);\n}')
  })

  it('restored node ids/types/ports match the originals exactly', async () => {
    const { editor: src } = createGraph()
    const cube = new CubeNode()
    const diff = new DifferenceNode()
    await src.addNode(cube)
    await src.addNode(diff)
    await src.addConnection(connect(cube, 'geometry', diff, 'base'))

    const { editor: dst } = createGraph()
    await roundTrip({ editor: src, positions: {} }, dst)

    expect(dst.getNode(cube.id)?.label).toBe('Cube')
    expect(dst.getNode(diff.id)?.label).toBe('Difference')
    const [connection] = dst.getConnections()
    expect(connection.source).toBe(cube.id)
    expect(connection.sourceOutput).toBe('geometry')
    expect(connection.target).toBe(diff.id)
    expect(connection.targetInput).toBe('base')
  })
})

describe('layout persistence', () => {
  it('restores exact, deliberately unusual node positions', async () => {
    const { editor: src } = createGraph()
    const a = new CubeNode()
    const b = new SphereNode()
    const c = new CylinderNode()
    await src.addNode(a)
    await src.addNode(b)
    await src.addNode(c)

    const { editor: dst } = createGraph()
    const { restoredPositions } = await roundTrip(
      {
        editor: src,
        positions: {
          [a.id]: { x: -400, y: 250 },
          [b.id]: { x: 0, y: 0 },
          [c.id]: { x: 1250.5, y: -300 },
        },
      },
      dst,
    )

    expect(restoredPositions[a.id]).toEqual({ x: -400, y: 250 })
    expect(restoredPositions[b.id]).toEqual({ x: 0, y: 0 })
    expect(restoredPositions[c.id]).toEqual({ x: 1250.5, y: -300 })
  })

  it('restores a non-zero pan and non-default zoom viewport', async () => {
    const { editor: src } = createGraph()
    const { editor: dst } = createGraph()

    let restoredViewport: { x: number; y: number; k: number } | undefined
    const project = serializeProject({
      editor: src,
      metadata: { name: 'X' },
      getNodePosition: () => ({ x: 0, y: 0 }),
      viewport: { x: -220, y: 75, k: 1.75 },
      viewerCamera: { position: [0, 0, 0], target: [0, 0, 0] },
    })
    await restoreProject(parseScadletProject(JSON.parse(JSON.stringify(project))), {
      editor: dst,
      creationContext: noopContext,
      setNodePosition: () => {},
      setViewport: (viewport) => {
        restoredViewport = viewport
      },
    })

    expect(restoredViewport).toEqual({ x: -220, y: 75, k: 1.75 })
  })
})

describe('viewer camera persistence', () => {
  it('restores a non-default camera position/target', async () => {
    const { editor: src } = createGraph()
    const { editor: dst } = createGraph()

    let restoredCamera: { position: [number, number, number]; target: [number, number, number] } | undefined
    const project = serializeProject({
      editor: src,
      metadata: { name: 'X' },
      getNodePosition: () => ({ x: 0, y: 0 }),
      viewport: { x: 0, y: 0, k: 1 },
      viewerCamera: { position: [123, -45, 67.5], target: [1, 2, 3] },
    })
    await restoreProject(parseScadletProject(JSON.parse(JSON.stringify(project))), {
      editor: dst,
      creationContext: noopContext,
      setNodePosition: () => {},
      setViewerCamera: (camera) => {
        restoredCamera = camera
      },
    })

    expect(restoredCamera).toEqual({ position: [123, -45, 67.5], target: [1, 2, 3] })
  })
})

describe('presentation-state persistence', () => {
  it('round-trips an unpinned node with no "pinned" key at all', async () => {
    const { editor: src } = createGraph()
    const cube = new CubeNode()
    await src.addNode(cube)

    const project = serializeProject({
      editor: src,
      metadata: { name: 'X' },
      getNodePosition: () => ({ x: 0, y: 0 }),
      isPinned: () => false,
      viewport: { x: 0, y: 0, k: 1 },
      viewerCamera: { position: [0, 0, 0], target: [0, 0, 0] },
    })

    expect(project.graph.nodes[0].pinned).toBeUndefined()
    expect(JSON.stringify(project)).not.toContain('"pinned"')
  })

  it('round-trips a pinned node, restoring pinned=true via setPinned', async () => {
    const { editor: src } = createGraph()
    const cube = new CubeNode()
    await src.addNode(cube)

    const { editor: dst } = createGraph()
    const { restoredPinned } = await roundTrip({ editor: src, positions: {}, pinned: new Set([cube.id]) }, dst)

    expect(restoredPinned.has(cube.id)).toBe(true)
  })

  it('never includes selection, marquee, hover, or inspect state in the serialized project', async () => {
    const { editor: src } = createGraph()
    await src.addNode(new CubeNode())

    const project = serializeProject({
      editor: src,
      metadata: { name: 'X' },
      getNodePosition: () => ({ x: 0, y: 0 }),
      viewport: { x: 0, y: 0, k: 1 },
      viewerCamera: { position: [0, 0, 0], target: [0, 0, 0] },
    })

    const json = JSON.stringify(project)
    expect(json).not.toMatch(/selected|marquee|inspect|hover/i)
  })
})

describe('export semantics with an inspected intermediate node (Inspect Node is not part of persistence)', () => {
  it('serializes the complete graph, independent of which node would currently be inspected in the UI', async () => {
    const { editor: src } = createGraph()
    const cube = new CubeNode()
    const sphere = new SphereNode()
    const union = new UnionNode()
    const rotate = new RotateNode({ z: 45 })
    await src.addNode(cube)
    await src.addNode(sphere)
    await src.addNode(union)
    await src.addNode(rotate)
    await src.addConnection(connect(cube, 'geometry', union, 'a'))
    await src.addConnection(connect(sphere, 'geometry', union, 'b'))
    await src.addConnection(connect(union, 'geometry', rotate, 'geometry'))

    // serializeProject has no notion of "inspected node" at all - it only
    // ever reads editor.getNodes()/getConnections() plus the injected
    // position/pin/viewport/camera accessors, so there is nothing here
    // that even *could* short-circuit to an inspected subtree; this test
    // documents/protects that architectural fact directly.
    const project = serializeProject({
      editor: src,
      metadata: { name: 'X' },
      getNodePosition: () => ({ x: 0, y: 0 }),
      viewport: { x: 0, y: 0, k: 1 },
      viewerCamera: { position: [0, 0, 0], target: [0, 0, 0] },
    })

    expect(project.graph.nodes).toHaveLength(4)
    expect(project.graph.connections).toHaveLength(3)

    const { editor: dst, engine } = createGraph()
    await restoreProject(parseScadletProject(JSON.parse(JSON.stringify(project))), {
      editor: dst,
      creationContext: noopContext,
      setNodePosition: () => {},
    })

    expect(await evaluateOpenSCAD(dst, engine)).toBe(
      'rotate([0, 0, 45]) {\n    union() {\n        cube(10);\n        sphere(r=5);\n    }\n}',
    )
  })
})

describe('repeated round trips', () => {
  it('serialize -> restore -> serialize -> restore -> serialize produces no semantic drift', async () => {
    const { editor: gen1 } = createGraph()
    const cube = new CubeNode({ sizeX: 2, sizeY: 3, sizeZ: 4 })
    const sphere = new SphereNode({ mode: 'diameter', d: 9 })
    const union = new UnionNode()
    await gen1.addNode(cube)
    await gen1.addNode(sphere)
    await gen1.addNode(union)
    await gen1.addConnection(connect(cube, 'geometry', union, 'a'))
    await gen1.addConnection(connect(sphere, 'geometry', union, 'b'))

    const positions = { [cube.id]: { x: 10, y: 20 }, [sphere.id]: { x: 30, y: 40 }, [union.id]: { x: 50, y: 60 } }

    const project1 = serializeProject({
      editor: gen1,
      metadata: { name: 'Drift Check' },
      getNodePosition: (id) => positions[id as keyof typeof positions] ?? { x: 0, y: 0 },
      viewport: { x: 1, y: 2, k: 1.2 },
      viewerCamera: { position: [1, 2, 3], target: [0, 0, 0] },
      now: () => '2026-01-01T00:00:00.000Z',
    })

    const { editor: gen2 } = createGraph()
    await restoreProject(parseScadletProject(JSON.parse(JSON.stringify(project1))), {
      editor: gen2,
      creationContext: noopContext,
      setNodePosition: () => {},
    })

    const project2 = serializeProject({
      editor: gen2,
      metadata: project1.metadata,
      getNodePosition: (id) => positions[id as keyof typeof positions] ?? { x: 0, y: 0 },
      viewport: { x: 1, y: 2, k: 1.2 },
      viewerCamera: { position: [1, 2, 3], target: [0, 0, 0] },
      now: () => '2026-01-01T00:00:00.000Z',
    })

    const { editor: gen3 } = createGraph()
    await restoreProject(parseScadletProject(JSON.parse(JSON.stringify(project2))), {
      editor: gen3,
      creationContext: noopContext,
      setNodePosition: () => {},
    })

    const project3 = serializeProject({
      editor: gen3,
      metadata: project2.metadata,
      getNodePosition: (id) => positions[id as keyof typeof positions] ?? { x: 0, y: 0 },
      viewport: { x: 1, y: 2, k: 1.2 },
      viewerCamera: { position: [1, 2, 3], target: [0, 0, 0] },
      now: () => '2026-01-01T00:00:00.000Z',
    })

    expect(project2).toEqual(project1)
    expect(project3).toEqual(project2)
  })
})

import { ClassicPreset, NodeEditor } from 'rete'
import { describe, expect, it } from 'vitest'

import { attachSocketCompatibilityGuard } from './editor'
import { DefinitionRegistry, moduleGeometryInputPortId, bindDefinitionRegistry, moduleNameProblem } from './definitions'
import { removeNodeWithConnections } from './deletion'
import { CubeNode } from './nodes/cube-node'
import { ModuleInputsNode, ModuleOutputNode } from './nodes/module-interface-nodes'
import { scopeTransferProblem } from './scope-transfer'
import { TranslateNode } from './nodes/translate-node'
import { ModuleCallNode } from './nodes/module-call-node'
import type { Schemes } from './schemes'

function definition() {
  return { id: 'definition-wheel', kind: 'module' as const, name: 'wheel', inputsNodeId: 'wheel-inputs', outputNodeId: 'wheel-output' }
}

describe('Module definitions', () => {
  it('uses a stable identity separate from its valid OpenSCAD-style name', () => {
    expect(moduleNameProblem('wheel', [])).toBeNull()
    expect(moduleNameProblem('', [])).toBe('empty')
    expect(moduleNameProblem('wheel-size', [])).toBe('identifier')
    expect(moduleNameProblem('wheel', ['wheel'])).toBe('duplicate')

    const registry = new DefinitionRegistry()
    registry.add(definition())
    expect(registry.get('definition-wheel')).toMatchObject({ id: 'definition-wheel', kind: 'module', name: 'wheel' })
    expect(registry.scopeOf('wheel-inputs')).toBe('definition-wheel')
    expect(registry.scopeOf('wheel-output')).toBe('definition-wheel')
  })

  it('has exactly the two permanent interface roles, and Output has one Geometry input', () => {
    const child = { id: 'geometry-1', name: 'Geometry 1' }
    const inputs = new ModuleInputsNode([], [child])
    const output = new ModuleOutputNode()
    expect(Object.keys(inputs.inputs)).toEqual([])
    expect(Object.keys(inputs.outputs)).toEqual([moduleGeometryInputPortId(child.id)])
    expect(inputs.outputs[moduleGeometryInputPortId(child.id)]?.socket.name).toBe('geometry')
    expect(Object.keys(output.inputs)).toEqual(['geometry'])
    expect(output.inputs.geometry?.socket.name).toBe('geometry')
  })

  it('keeps ordinary body ownership separate from protected interface roles', () => {
    const registry = new DefinitionRegistry()
    registry.add(definition())
    registry.assignNode('definition-wheel', 'wheel-cube')
    expect(registry.nodeIds('definition-wheel')).toEqual(['wheel-inputs', 'wheel-output', 'wheel-cube'])
    expect(registry.scopeOf('wheel-cube')).toBe('definition-wheel')
    expect(registry.isProtectedNode('wheel-cube')).toBe(false)
  })

  it('renames by stable definition id and removes the entire owned scope only on deletion', () => {
    const registry = new DefinitionRegistry()
    registry.add(definition())
    registry.assignNode('definition-wheel', 'wheel-cube')
    expect(registry.rename('definition-wheel', 'rim')).toBe(true)
    expect(registry.rename('definition-wheel', 'rim')).toBe(false)
    expect(registry.get('definition-wheel')?.name).toBe('rim')
    expect(registry.scopeOf('wheel-cube')).toBe('definition-wheel')
    registry.remove('definition-wheel')
    expect(registry.get('definition-wheel')).toBeUndefined()
    expect(registry.nodeIds('definition-wheel')).toEqual([])
    expect(registry.scopeOf('wheel-inputs')).toBeNull()
    expect(registry.scopeOf('wheel-cube')).toBeNull()
  })

  it('protects both interface nodes through the generic deletion helper', async () => {
    const editor = new NodeEditor<Schemes>()
    const registry = new DefinitionRegistry()
    registry.add(definition())
    const inputs = new ModuleInputsNode(); inputs.id = 'wheel-inputs'
    const output = new ModuleOutputNode(); output.id = 'wheel-output'
    await editor.addNode(inputs)
    await editor.addNode(output)

    expect(await removeNodeWithConnections(editor, inputs.id, (id) => !registry.isProtectedNode(id))).toBe(false)
    expect(await removeNodeWithConnections(editor, output.id, (id) => !registry.isProtectedNode(id))).toBe(false)
    expect(editor.getNodes()).toHaveLength(2)
  })

  it('rejects a type-compatible Main Geometry wire crossing into a Module Output', async () => {
    const editor = new NodeEditor<Schemes>()
    const registry = new DefinitionRegistry()
    bindDefinitionRegistry(editor, registry)
    attachSocketCompatibilityGuard(editor)
    registry.add(definition())
    const cube = new CubeNode(); cube.id = 'main-cube'
    const output = new ModuleOutputNode(); output.id = 'wheel-output'
    await editor.addNode(cube)
    await editor.addNode(output)

    const created = await editor.addConnection(new ClassicPreset.Connection(cube, 'geometry', output, 'geometry') as Schemes['Connection'])
    expect(created).toBe(false)
    expect(editor.getConnections()).toEqual([])
  })

  it('preflights a selected connected group atomically before changing scope', async () => {
    const editor = new NodeEditor<Schemes>()
    const registry = new DefinitionRegistry()
    registry.add(definition())
    const cube = new CubeNode(); cube.id = 'cube'
    const translate = new TranslateNode(); translate.id = 'translate'
    await editor.addNode(cube)
    await editor.addNode(translate)
    await editor.addConnection(new ClassicPreset.Connection(cube, 'geometry', translate, 'geometry') as Schemes['Connection'])

    expect(scopeTransferProblem(editor, registry, [cube.id], 'definition-wheel')).toBe('connection')
    expect(scopeTransferProblem(editor, registry, [cube.id, translate.id], 'definition-wheel')).toBeNull()
    registry.setNodeScopes([cube.id, translate.id], 'definition-wheel')
    expect(registry.scopeOf(cube.id)).toBe('definition-wheel')
    expect(registry.scopeOf(translate.id)).toBe('definition-wheel')
    expect(editor.getConnections()).toHaveLength(1)
  })

  it('allows a connection-safe Module-to-Module transfer but never interfaces or Main-only calls', async () => {
    const editor = new NodeEditor<Schemes>()
    const registry = new DefinitionRegistry()
    const wheel = definition()
    const axle = { ...definition(), id: 'definition-axle', name: 'axle', inputsNodeId: 'axle-inputs', outputNodeId: 'axle-output' }
    registry.add(wheel)
    registry.add(axle)
    const sphere = new CubeNode(); sphere.id = 'body-node'
    const call = new ModuleCallNode(wheel.id, wheel.name); call.id = 'call'
    await editor.addNode(sphere)
    await editor.addNode(call)
    registry.assignNode(wheel.id, sphere.id)

    expect(scopeTransferProblem(editor, registry, [sphere.id], axle.id)).toBeNull()
    registry.setNodeScopes([sphere.id], axle.id)
    expect(registry.scopeOf(sphere.id)).toBe(axle.id)
    expect(scopeTransferProblem(editor, registry, [wheel.inputsNodeId], null)).toBe('protected')
    expect(scopeTransferProblem(editor, registry, [call.id], wheel.id)).toBe('module-call')
  })
})

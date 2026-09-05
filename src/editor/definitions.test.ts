import { ClassicPreset, NodeEditor } from 'rete'
import { describe, expect, it } from 'vitest'

import { attachSocketCompatibilityGuard } from './editor'
import { DefinitionRegistry, bindDefinitionRegistry, moduleNameProblem } from './definitions'
import { removeNodeWithConnections } from './deletion'
import { CubeNode } from './nodes/cube-node'
import { ModuleInputsNode, ModuleOutputNode } from './nodes/module-interface-nodes'
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
    const inputs = new ModuleInputsNode()
    const output = new ModuleOutputNode()
    expect(Object.keys(inputs.inputs)).toEqual([])
    expect(Object.keys(inputs.outputs)).toEqual([])
    expect(Object.keys(output.inputs)).toEqual(['geometry'])
    expect(output.inputs.geometry?.socket.name).toBe('geometry')
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
})

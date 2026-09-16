import { ClassicPreset, NodeEditor } from 'rete'
import { DataflowEngine } from 'rete-engine'
import { describe, expect, it } from 'vitest'

import { DefinitionRegistry } from './definitions'
import { evaluateOpenSCAD } from './evaluate'
import { ArithmeticNode, NumberNode, Vector3Node } from './nodes/value-nodes'
import { VariableReferenceNode } from './nodes/variable-reference-node'
import { CubeNode } from './nodes/cube-node'
import { TranslateNode } from './nodes/translate-node'
import { FunctionInputsNode, FunctionOutputNode } from './nodes/function-interface-nodes'
import { ModuleInputsNode, ModuleOutputNode } from './nodes/module-interface-nodes'
import { ScadSettingsNode } from './nodes/scad-settings-node'
import type { Schemes } from './schemes'
import { parseScadletProject } from '../persistence/validate'
import { restoreProject } from '../persistence/restore'
import { serializeProject } from '../persistence/serialize'
import { scopeTransferProblem } from './scope-transfer'

const camera = { position: [80, 80, 60] as [number, number, number], target: [0, 0, 0] as [number, number, number] }

function engine(): DataflowEngine<Schemes> {
  return new DataflowEngine<Schemes>((node) => ({ inputs: () => Object.keys(node.inputs), outputs: () => Object.keys(node.outputs) }))
}

function connect(source: ClassicPreset.Node, sourceOutput: string, target: ClassicPreset.Node, targetInput: string) {
  return new ClassicPreset.Connection<ClassicPreset.Node, ClassicPreset.Node>(source, sourceOutput, target, targetInput)
}

describe('scoped variables', () => {
  it('emits dependency-safe Main assignments while preserving direct Value output semantics', async () => {
    const editor = new NodeEditor<Schemes>()
    const dataflow = engine(); editor.use(dataflow)
    const offset = new Vector3Node({ name: 'offset', bindingId: 'offset-id', x: 0, y: 2, z: 3 })
    const spacing = new NumberNode({ name: 'spacing', bindingId: 'spacing-id', value: 12 })
    const spacingReference = new VariableReferenceNode({ bindingId: 'spacing-id' }, { id: 'spacing-id', name: 'spacing', type: 'number' })
    const offsetReference = new VariableReferenceNode({ bindingId: 'offset-id' }, { id: 'offset-id', name: 'offset', type: 'vector3' })
    const cube = new CubeNode({ sizeRepresentation: 'scalar', size: 1 })
    const directCube = new CubeNode({ sizeRepresentation: 'scalar', size: 1 })
    const move = new TranslateNode({ x: 0, y: 0, z: 0, representation: 'vector' })
    for (const node of [offset, spacing, spacingReference, offsetReference, cube, directCube, move]) await editor.addNode(node)
    await editor.addConnection(connect(spacingReference, 'value', offset, 'x'))
    await editor.addConnection(connect(offsetReference, 'value', move, 'vector'))
    await editor.addConnection(connect(cube, 'geometry', move, 'geometry'))
    await editor.addConnection(connect(spacing, 'value', directCube, 'size'))

    expect(await evaluateOpenSCAD(editor, dataflow)).toBe(
      'spacing = 12;\noffset = [spacing, 2, 3];\ncube(12);\ntranslate(offset) {\n    cube(1);\n}',
    )
  })

  it('uses a connected expression for a named Value assignment, direct output, and stable-ID references', async () => {
    const editor = new NodeEditor<Schemes>()
    const dataflow = engine(); editor.use(dataflow)
    const width = new NumberNode({ name: 'width', bindingId: 'width-id', value: 12 })
    const widthReference = new VariableReferenceNode({ bindingId: 'width-id' }, { id: 'width-id', name: 'width', type: 'number' })
    const divide = new ArithmeticNode({ operation: 'division', a: 0, b: 3 })
    const spacing = new NumberNode({ name: 'spacing', bindingId: 'spacing-id', value: 99 })
    const spacingReference = new VariableReferenceNode({ bindingId: 'spacing-id' }, { id: 'spacing-id', name: 'spacing', type: 'number' })
    const cube = new CubeNode({ sizeRepresentation: 'scalar', size: 1 })
    for (const node of [spacing, spacingReference, width, widthReference, divide, cube]) await editor.addNode(node)
    await editor.addConnection(connect(widthReference, 'value', divide, 'a'))
    await editor.addConnection(connect(divide, 'value', spacing, 'value'))
    await editor.addConnection(connect(spacingReference, 'value', cube, 'size'))

    expect(await evaluateOpenSCAD(editor, dataflow)).toBe(
      'width = 12;\nspacing = (width / 3);\ncube(spacing);',
    )
    dataflow.reset()
    expect((await dataflow.fetch(spacing.id)).value?.code).toBe('(width / 3)')
    expect(spacingReference.data().value.code).toBe('spacing')
  })

  it('wraps connected named Values in a dependency-ordered Function let expression', async () => {
    const editor = new NodeEditor<Schemes>()
    const dataflow = engine(); editor.use(dataflow)
    const definitions = new DefinitionRegistry()
    const definition = {
      id: 'function-id', kind: 'function' as const, name: 'third', inputsNodeId: 'inputs', outputNodeId: 'output',
      parameters: [{ id: 'width-id', name: 'width', type: 'number' as const, default: 12 }], resultType: 'number' as const,
    }
    definitions.add(definition)
    const inputs = new FunctionInputsNode(definition.parameters); inputs.id = definition.inputsNodeId
    const output = new FunctionOutputNode('number'); output.id = definition.outputNodeId
    const widthReference = new VariableReferenceNode({ bindingId: 'width-id' }, { id: 'width-id', name: 'width', type: 'number' })
    const divide = new ArithmeticNode({ operation: 'division', a: 0, b: 3 })
    const spacing = new NumberNode({ name: 'spacing', bindingId: 'spacing-id', value: 99 })
    const spacingReference = new VariableReferenceNode({ bindingId: 'spacing-id' }, { id: 'spacing-id', name: 'spacing', type: 'number' })
    for (const node of [inputs, output, widthReference, divide, spacing, spacingReference]) await editor.addNode(node)
    for (const node of [widthReference, divide, spacing, spacingReference]) definitions.assignNode(definition.id, node.id)
    await editor.addConnection(connect(widthReference, 'value', divide, 'a'))
    await editor.addConnection(connect(divide, 'value', spacing, 'value'))
    await editor.addConnection(connect(spacingReference, 'value', output, 'result'))

    expect(await evaluateOpenSCAD(editor, dataflow, undefined, definitions)).toBe(
      'function third(width = 12) = let(spacing = (width / 3)) spacing;',
    )
  })

  it('uses parameter identifiers and valid Function let syntax inside independent scopes', async () => {
    const editor = new NodeEditor<Schemes>()
    const dataflow = engine(); editor.use(dataflow)
    const definitions = new DefinitionRegistry()
    const moduleDefinition = {
      id: 'module-id', kind: 'module' as const, name: 'block', inputsNodeId: 'module-inputs', outputNodeId: 'module-output',
      parameters: [{ id: 'module-size', name: 'size', type: 'number' as const, default: 4 }], geometryInputs: [],
    }
    const functionDefinition = {
      id: 'function-id', kind: 'function' as const, name: 'double_spacing', inputsNodeId: 'function-inputs', outputNodeId: 'function-output',
      parameters: [{ id: 'function-x', name: 'x', type: 'number' as const, default: 2 }], resultType: 'number' as const,
    }
    definitions.add(moduleDefinition); definitions.add(functionDefinition)
    const moduleInputs = new ModuleInputsNode(moduleDefinition.parameters); moduleInputs.id = moduleDefinition.inputsNodeId
    const moduleOutput = new ModuleOutputNode(); moduleOutput.id = moduleDefinition.outputNodeId
    const parameterReference = new VariableReferenceNode({ bindingId: 'module-size' }, { id: 'module-size', name: 'size', type: 'number' })
    const cube = new CubeNode({ sizeRepresentation: 'scalar', size: 1 })
    const functionInputs = new FunctionInputsNode(functionDefinition.parameters); functionInputs.id = functionDefinition.inputsNodeId
    const functionOutput = new FunctionOutputNode('number'); functionOutput.id = functionDefinition.outputNodeId
    const local = new NumberNode({ name: 'spacing', bindingId: 'local-spacing', value: 12 })
    const localReference = new VariableReferenceNode({ bindingId: 'local-spacing' }, { id: 'local-spacing', name: 'spacing', type: 'number' })
    const xReference = new VariableReferenceNode({ bindingId: 'function-x' }, { id: 'function-x', name: 'x', type: 'number' })
    const sum = new ArithmeticNode({ operation: 'addition', a: 0, b: 0 })
    for (const node of [moduleInputs, moduleOutput, parameterReference, cube, functionInputs, functionOutput, local, localReference, xReference, sum]) await editor.addNode(node)
    for (const id of [parameterReference.id, cube.id]) definitions.assignNode('module-id', id)
    for (const id of [local.id, localReference.id, xReference.id, sum.id]) definitions.assignNode('function-id', id)
    await editor.addConnection(connect(parameterReference, 'value', cube, 'size'))
    await editor.addConnection(connect(cube, 'geometry', moduleOutput, 'geometry'))
    await editor.addConnection(connect(localReference, 'value', sum, 'a'))
    await editor.addConnection(connect(xReference, 'value', sum, 'b'))
    await editor.addConnection(connect(sum, 'value', functionOutput, 'result'))

    expect(await evaluateOpenSCAD(editor, dataflow, undefined, definitions)).toBe(
      'function double_spacing(x = 2) = let(spacing = 12) (spacing + x);\n\nmodule block(size = 4) {\n  cube(size);\n}',
    )
  })

  it('orders a named Value before scoped settings that reference it', async () => {
    const editor = new NodeEditor<Schemes>()
    const dataflow = engine(); editor.use(dataflow)
    const detail = new NumberNode({ name: 'detail', bindingId: 'detail-id', value: 24 })
    const reference = new VariableReferenceNode({ bindingId: 'detail-id' }, { id: 'detail-id', name: 'detail', type: 'number' })
    const settings = new ScadSettingsNode({ fn: 0 })
    const cube = new CubeNode({ sizeRepresentation: 'scalar', size: 1 })
    for (const node of [detail, reference, settings, cube]) await editor.addNode(node)
    await editor.addConnection(connect(reference, 'value', settings, 'fn'))
    expect(await evaluateOpenSCAD(editor, dataflow)).toBe('detail = 24;\n$fn = detail;\ncube(1);')
  })

  it('validates same-scope conflicts, permits the same name in separate scopes, and rejects stale or cross-scope references', () => {
    const base = {
      format: 'scadlet', version: 8, metadata: { name: 'Variables' },
      graph: { nodes: [
        { id: 'main-a', type: 'number', position: { x: 0, y: 0 }, parameters: { value: 1, name: 'shared', bindingId: 'main-binding' } },
      ], connections: [] },
      definitions: [{
        id: 'fn', kind: 'function', name: 'f', interface: { inputs: 'in', output: 'out' },
        parameters: [{ id: 'main-binding', name: 'shared', type: 'number', default: 0 }], resultType: 'number',
        graph: { nodes: [
          { id: 'in', type: 'function-inputs', position: { x: 0, y: 0 }, parameters: {} },
          { id: 'out', type: 'function-output', position: { x: 300, y: 0 }, parameters: {} },
          { id: 'ref', type: 'variable-reference', position: { x: 150, y: 0 }, parameters: { bindingId: 'main-binding' } },
        ], connections: [{ id: 'result', source: 'ref', sourceOutput: 'value', target: 'out', targetInput: 'result' }] },
      }],
      editor: { viewport: { x: 0, y: 0, zoom: 1 } }, viewer: { camera },
    }
    expect(parseScadletProject(base).version).toBe(8)
    const duplicate = structuredClone(base)
    duplicate.graph.nodes.push({ id: 'main-b', type: 'number', position: { x: 10, y: 10 }, parameters: { value: 2, name: 'shared', bindingId: 'other' } })
    expect(() => parseScadletProject(duplicate)).toThrow('Duplicate binding name "shared" in one scope')
    const parameterCollision = structuredClone(base)
    parameterCollision.definitions[0]!.graph.nodes.push({
      id: 'local-value', type: 'number', position: { x: 20, y: 20 },
      parameters: { value: 3, name: 'shared', bindingId: 'local-binding' },
    } as unknown as (typeof parameterCollision.definitions)[number]['graph']['nodes'][number])
    expect(() => parseScadletProject(parameterCollision)).toThrow('Duplicate binding name "shared" in one scope')
    const stale = structuredClone(base)
    stale.definitions[0]!.graph.nodes[2]!.parameters.bindingId = 'missing'
    expect(() => parseScadletProject(stale)).toThrow('missing, stale, or cross-scope binding')
  })

  it('round-trips stable references and keeps migrated v7 Value labels literal-only', async () => {
    const raw = {
      format: 'scadlet', version: 8, metadata: { name: 'Round trip' },
      graph: { nodes: [
        { id: 'value', type: 'number', position: { x: 0, y: 0 }, parameters: { value: 9, name: 'size', bindingId: 'size-id' } },
        { id: 'reference', type: 'variable-reference', position: { x: 100, y: 0 }, parameters: { bindingId: 'size-id' } },
        { id: 'cube', type: 'cube', position: { x: 200, y: 0 }, parameters: { sizeRepresentation: 'scalar', size: 1, sizeScalar: 1, sizeVector: { x: 1, y: 1, z: 1 } } },
      ], connections: [{ id: 'wire', source: 'reference', sourceOutput: 'value', target: 'cube', targetInput: 'size' }] },
      definitions: [], editor: { viewport: { x: 0, y: 0, zoom: 1 } }, viewer: { camera },
    }
    const project = parseScadletProject(raw)
    const editor = new NodeEditor<Schemes>()
    const dataflow = engine(); editor.use(dataflow)
    await restoreProject(project, { editor, creationContext: { onControlsChanged: () => {} }, setNodePosition: () => {} })
    expect(await evaluateOpenSCAD(editor, dataflow)).toBe('size = 9;\ncube(size);')
    const saved = serializeProject({ editor, metadata: project.metadata, getNodePosition: () => ({ x: 0, y: 0 }), viewport: { x: 0, y: 0, k: 1 }, viewerCamera: camera })
    expect(saved.graph.nodes.find((node) => node.id === 'reference')?.parameters).toEqual({ bindingId: 'size-id' })

    const legacy = {
      ...structuredClone(raw),
      version: 7,
      graph: {
        nodes: [{ id: 'value', type: 'number', position: { x: 0, y: 0 }, parameters: { value: 9, name: 'size' } }],
        connections: [],
      },
    }
    expect(parseScadletProject(legacy).graph.nodes[0]!.parameters).toEqual({ value: 9, name: 'size' })
  })

  it('reports stale references and circular binding dependencies before emitting source', async () => {
    const staleEditor = new NodeEditor<Schemes>()
    const staleEngine = engine(); staleEditor.use(staleEngine)
    await staleEditor.addNode(new VariableReferenceNode(
      { bindingId: 'missing' },
      { id: 'missing', name: 'missing', type: 'number' },
    ))
    await expect(evaluateOpenSCAD(staleEditor, staleEngine, undefined, new DefinitionRegistry()))
      .rejects.toThrow('same scope')

    const editor = new NodeEditor<Schemes>()
    const dataflow = engine(); editor.use(dataflow)
    const first = new Vector3Node({ name: 'first', bindingId: 'first-id', x: 0, y: 0, z: 0 })
    const second = new Vector3Node({ name: 'second', bindingId: 'second-id', x: 0, y: 0, z: 0 })
    const firstReference = new VariableReferenceNode({ bindingId: 'first-id' }, { id: 'first-id', name: 'first', type: 'vector3' })
    const secondReference = new VariableReferenceNode({ bindingId: 'second-id' }, { id: 'second-id', name: 'second', type: 'vector3' })
    for (const node of [first, second, firstReference, secondReference]) await editor.addNode(node)
    // A bare Rete editor intentionally bypasses the UI socket guard here so
    // this defensive evaluator path remains covered even for corrupt runtime
    // state. Persisted projects reject the incompatible edges even earlier.
    await editor.addConnection(connect(firstReference, 'value', second, 'x'))
    await editor.addConnection(connect(secondReference, 'value', first, 'x'))
    await expect(evaluateOpenSCAD(editor, dataflow, undefined, new DefinitionRegistry()))
      .rejects.toThrow('circular dependency')
  })

  it('preflights scope moves for bindings and their references as one stable-ID unit', async () => {
    const editor = new NodeEditor<Schemes>()
    const definitions = new DefinitionRegistry()
    const definition = {
      id: 'module', kind: 'module' as const, name: 'part', inputsNodeId: 'inputs', outputNodeId: 'output',
      parameters: [{ id: 'parameter', name: 'taken', type: 'number' as const, default: 1 }], geometryInputs: [],
    }
    definitions.add(definition)
    const value = new NumberNode({ name: 'spacing', bindingId: 'spacing-id', value: 2 })
    const reference = new VariableReferenceNode({ bindingId: 'spacing-id' }, { id: 'spacing-id', name: 'spacing', type: 'number' })
    await editor.addNode(value); await editor.addNode(reference)
    expect(scopeTransferProblem(editor, definitions, [reference.id], definition.id)).toBe('variable-reference')
    expect(scopeTransferProblem(editor, definitions, [value.id, reference.id], definition.id)).toBeNull()

    const conflicting = new NumberNode({ name: 'taken', bindingId: 'taken-id', value: 3 })
    await editor.addNode(conflicting)
    expect(scopeTransferProblem(editor, definitions, [conflicting.id], definition.id)).toBe('binding-conflict')
  })
})

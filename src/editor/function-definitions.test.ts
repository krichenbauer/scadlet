import { ClassicPreset, NodeEditor } from 'rete'
import { DataflowEngine } from 'rete-engine'
import { describe, expect, it } from 'vitest'

import { canConnectSocketData } from './connection-compatibility'
import { DefinitionRegistry, bindDefinitionRegistry, type ModuleDefinition } from './definitions'
import { evaluateOpenSCAD } from './evaluate'
import { FunctionCallNode } from './nodes/function-call-node'
import { FunctionInputsNode, FunctionOutputNode } from './nodes/function-interface-nodes'
import { CubeNode } from './nodes/cube-node'
import { ModuleCallNode } from './nodes/module-call-node'
import { ModuleInputsNode, ModuleOutputNode } from './nodes/module-interface-nodes'
import { ArithmeticNode, BasicMathNode, BooleanNode, CompareNode, ConditionalNode, ExponentialLogNode, NumberNode, TrigonometryNode, Vector3Node } from './nodes/value-nodes'
import { scopeTransferProblem } from './scope-transfer'
import type { Schemes } from './schemes'

function graph() {
  const editor = new NodeEditor<Schemes>()
  const engine = new DataflowEngine<Schemes>((node) => ({ inputs: () => Object.keys(node.inputs), outputs: () => Object.keys(node.outputs) }))
  editor.use(engine)
  return { editor, engine }
}

function functionDefinition(overrides: Partial<ModuleDefinition> = {}): ModuleDefinition {
  return {
    id: 'fn-double', kind: 'function', name: 'double_size',
    inputsNodeId: 'fn-double-inputs', outputNodeId: 'fn-double-output',
    parameters: [{ id: 'x-id', name: 'x', type: 'number', default: 1 }],
    ...overrides,
  }
}

describe('Function definitions (Milestone 8 Phase 7)', () => {
  it('starts unresolved: Function Output has a neutral socket and no parameters yet', () => {
    const inputs = new FunctionInputsNode()
    const output = new FunctionOutputNode()
    expect(Object.keys(inputs.outputs)).toEqual([])
    expect(output.inputs.result?.socket.name).toBe('unresolved')
  })

  it('exposes ordered parameters as typed outputs, mirrored on Function Calls', () => {
    const definition = functionDefinition()
    const withBoolean = { ...definition, parameters: [...(definition.parameters ?? []), { id: 'flag-id', name: 'flag', type: 'boolean' as const, default: false }], resultType: 'number' as const }
    const inputs = new FunctionInputsNode(withBoolean.parameters)
    const call = new FunctionCallNode(withBoolean, { definitionId: withBoolean.id })
    expect(Object.keys(inputs.outputs)).toEqual(['parameter:x-id', 'parameter:flag-id'])
    expect(inputs.outputs['parameter:x-id']?.socket.name).toBe('number')
    expect(inputs.outputs['parameter:flag-id']?.socket.name).toBe('boolean')
    expect(Object.keys(call.inputs)).toEqual(['parameter:x-id', 'parameter:flag-id'])
    expect(call.outputs.value?.socket.name).toBe('number')
  })

  it('infers Number, Boolean, and Vector3 result types from the connected Output expression', async () => {
    for (const [type, node] of [['number', new NumberNode({ value: 5, name: 'n' })], ['boolean', new BooleanNode({ value: true, name: 'b' })], ['vector3', new Vector3Node({ x: 1, y: 2, z: 3, name: 'v' })]] as const) {
      const { editor, engine } = graph()
      const output = new FunctionOutputNode()
      await editor.addNode(node)
      await editor.addNode(output)
      await editor.addConnection(new ClassicPreset.Connection(node, 'value', output, 'result') as Schemes['Connection'])
      const fetched = (await engine.fetch(output.id)) as Record<string, unknown>
      expect(fetched).toEqual({})
      // Result-type inference itself is an `editor.ts`-level concern (it
      // mutates the registry/swaps the live socket); this asserts the
      // dataflow-level precondition it depends on: the connected source's
      // own output socket type.
      expect(node.outputs.value?.socket.name).toBe(type)
    }
  })

  it('generates the exact declaration and Call-expression form', async () => {
    const { editor, engine } = graph()
    const definitions = new DefinitionRegistry()
    const definition = { ...functionDefinition(), resultType: 'number' as const }
    definitions.add(definition)
    const inputs = new FunctionInputsNode(definition.parameters); inputs.id = definition.inputsNodeId
    const output = new FunctionOutputNode('number'); output.id = definition.outputNodeId
    const multiply = new ArithmeticNode({ operation: 'multiplication', a: 0, b: 2 }); multiply.id = 'multiply-node'
    const call = new FunctionCallNode(definition, { definitionId: definition.id }); call.id = 'call-1'
    const cube = new CubeNode(); cube.id = 'cube-1'
    for (const node of [inputs, output, multiply, call, cube]) await editor.addNode(node)
    await editor.addConnection(new ClassicPreset.Connection(inputs, 'parameter:x-id', multiply, 'a') as Schemes['Connection'])
    await editor.addConnection(new ClassicPreset.Connection(multiply, 'value', output, 'result') as Schemes['Connection'])
    ;(call.controls['parameter:x-id'] as unknown as { setValue(value: number): void }).setValue(10)

    const source = await evaluateOpenSCAD(editor, engine, undefined, definitions)
    expect(source).toContain('function double_size(x = 1) = (x * 2);')
    expect(call.data({}).value.code).toBe('double_size(x = 10)')
  })

  it('evaluates a nested Function Call through math and emits callee before caller and Main use', async () => {
    const { editor, engine } = graph()
    const definitions = new DefinitionRegistry()
    const outer = { id: 'fn-sixfold', kind: 'function' as const, name: 'sixfold', inputsNodeId: 'six-inputs', outputNodeId: 'six-output', parameters: [{ id: 'x', name: 'x', type: 'number' as const, default: 1 }], resultType: 'number' as const }
    const inner = { id: 'fn-double', kind: 'function' as const, name: 'double', inputsNodeId: 'double-inputs', outputNodeId: 'double-output', parameters: [{ id: 'x', name: 'x', type: 'number' as const, default: 1 }], resultType: 'number' as const }
    // Reverse declaration order proves generation is dependency-driven.
    definitions.add(outer); definitions.add(inner)
    const innerInputs = new FunctionInputsNode(inner.parameters); innerInputs.id = inner.inputsNodeId
    const innerOutput = new FunctionOutputNode('number'); innerOutput.id = inner.outputNodeId
    const innerMultiply = new ArithmeticNode({ operation: 'multiplication', a: 0, b: 2 }); innerMultiply.id = 'inner-multiply'
    const outerInputs = new FunctionInputsNode(outer.parameters); outerInputs.id = outer.inputsNodeId
    const outerOutput = new FunctionOutputNode('number'); outerOutput.id = outer.outputNodeId
    const triple = new ArithmeticNode({ operation: 'multiplication', a: 0, b: 3 }); triple.id = 'triple'
    const nestedCall = new FunctionCallNode(inner, { definitionId: inner.id }); nestedCall.id = 'nested-double'
    const mainCall = new FunctionCallNode(outer, { definitionId: outer.id }); mainCall.id = 'main-sixfold'
    const cube = new CubeNode({ size: 10 }); cube.id = 'main-cube'
    for (const node of [innerInputs, innerOutput, innerMultiply, outerInputs, outerOutput, triple, nestedCall, mainCall, cube]) await editor.addNode(node)
    for (const node of [innerMultiply]) definitions.assignNode(inner.id, node.id)
    for (const node of [triple, nestedCall]) definitions.assignNode(outer.id, node.id)
    await editor.addConnection(new ClassicPreset.Connection(innerInputs, 'parameter:x', innerMultiply, 'a') as Schemes['Connection'])
    await editor.addConnection(new ClassicPreset.Connection(innerMultiply, 'value', innerOutput, 'result') as Schemes['Connection'])
    await editor.addConnection(new ClassicPreset.Connection(outerInputs, 'parameter:x', nestedCall, 'parameter:x') as Schemes['Connection'])
    await editor.addConnection(new ClassicPreset.Connection(nestedCall, 'value', triple, 'a') as Schemes['Connection'])
    await editor.addConnection(new ClassicPreset.Connection(triple, 'value', outerOutput, 'result') as Schemes['Connection'])
    await editor.addConnection(new ClassicPreset.Connection(mainCall, 'value', cube, 'size') as Schemes['Connection'])

    const source = await evaluateOpenSCAD(editor, engine, undefined, definitions)
    expect(source).toBe('function double(x = 1) = (x * 2);\n\nfunction sixfold(x = 1) = (double(x = x) * 3);\n\ncube(sixfold(x = 1));')
  })

  it('generates a direct self-recursive Function through Compare and Conditional', async () => {
    const { editor, engine } = graph()
    const definitions = new DefinitionRegistry()
    const factorial = { id: 'factorial', kind: 'function' as const, name: 'factorial', inputsNodeId: 'factorial-in', outputNodeId: 'factorial-out', parameters: [{ id: 'n', name: 'n', type: 'number' as const, default: 5 }], resultType: 'number' as const }
    definitions.add(factorial)
    const inputs = new FunctionInputsNode(factorial.parameters); inputs.id = factorial.inputsNodeId
    const output = new FunctionOutputNode('number'); output.id = factorial.outputNodeId
    const compare = new CompareNode({ operator: '<=', a: 0, b: 0 }); compare.id = 'factorial-base'
    const one = new NumberNode({ value: 1, name: 'One' }); one.id = 'factorial-one'
    const decrement = new ArithmeticNode({ operation: 'subtraction', a: 0, b: 1 }); decrement.id = 'factorial-decrement'
    const recursiveCall = new FunctionCallNode(factorial, { definitionId: factorial.id }); recursiveCall.id = 'factorial-self'
    const multiply = new ArithmeticNode({ operation: 'multiplication', a: 0, b: 1 }); multiply.id = 'factorial-multiply'
    const conditional = new ConditionalNode({ valueType: 'number' }); conditional.id = 'factorial-choice'
    const mainCall = new FunctionCallNode(factorial, { definitionId: factorial.id, arguments: { n: 5 } }); mainCall.id = 'main-factorial'
    const cube = new CubeNode(); cube.id = 'main-cube'
    for (const node of [inputs, output, compare, one, decrement, recursiveCall, multiply, conditional, mainCall, cube]) await editor.addNode(node)
    for (const node of [compare, one, decrement, recursiveCall, multiply, conditional]) definitions.assignNode(factorial.id, node.id)
    for (const connection of [
      new ClassicPreset.Connection(inputs, 'parameter:n', compare, 'a'),
      new ClassicPreset.Connection(one, 'value', compare, 'b'),
      new ClassicPreset.Connection(inputs, 'parameter:n', decrement, 'a'),
      new ClassicPreset.Connection(decrement, 'value', recursiveCall, 'parameter:n'),
      new ClassicPreset.Connection(inputs, 'parameter:n', multiply, 'a'),
      new ClassicPreset.Connection(recursiveCall, 'value', multiply, 'b'),
      new ClassicPreset.Connection(compare, 'value', conditional, 'condition'),
      new ClassicPreset.Connection(one, 'value', conditional, 'true'),
      new ClassicPreset.Connection(multiply, 'value', conditional, 'false'),
      new ClassicPreset.Connection(conditional, 'result', output, 'result'),
      new ClassicPreset.Connection(mainCall, 'value', cube, 'size'),
    ]) await editor.addConnection(connection as Schemes['Connection'])

    expect(await evaluateOpenSCAD(editor, engine, undefined, definitions)).toBe(
      'function factorial(n = 5) = ((n <= 1) ? 1 : (n * factorial(n = (n - 1))));\n\ncube(factorial(n = 5));',
    )
  })

  it('generates mutually recursive Functions in stable project order', async () => {
    const { editor, engine } = graph()
    const definitions = new DefinitionRegistry()
    const odd = { id: 'odd', kind: 'function' as const, name: 'is_odd', inputsNodeId: 'odd-in', outputNodeId: 'odd-out', parameters: [{ id: 'n', name: 'n', type: 'number' as const, default: 5 }], resultType: 'boolean' as const }
    const even = { id: 'even', kind: 'function' as const, name: 'is_even', inputsNodeId: 'even-in', outputNodeId: 'even-out', parameters: [{ id: 'n', name: 'n', type: 'number' as const, default: 6 }], resultType: 'boolean' as const }
    // Reverse the familiar source order deliberately: SCC members must use
    // registry/project order, not traversal or connection insertion order.
    definitions.add(odd); definitions.add(even)
    const build = async (owner: typeof odd, callee: typeof even, base: boolean) => {
      const inputs = new FunctionInputsNode(owner.parameters); inputs.id = owner.inputsNodeId
      const output = new FunctionOutputNode('boolean'); output.id = owner.outputNodeId
      const compare = new CompareNode({ operator: '==', a: 0, b: 0 }); compare.id = `${owner.id}-base`
      const literal = new BooleanNode({ value: base, name: 'Base' }); literal.id = `${owner.id}-literal`
      const zero = new NumberNode({ value: 0, name: 'Zero' }); zero.id = `${owner.id}-zero`
      const decrement = new ArithmeticNode({ operation: 'subtraction', a: 0, b: 1 }); decrement.id = `${owner.id}-decrement`
      const call = new FunctionCallNode(callee, { definitionId: callee.id }); call.id = `${owner.id}-call`
      const conditional = new ConditionalNode({ valueType: 'boolean' }); conditional.id = `${owner.id}-choice`
      for (const node of [inputs, output, compare, literal, zero, decrement, call, conditional]) await editor.addNode(node)
      for (const node of [compare, literal, zero, decrement, call, conditional]) definitions.assignNode(owner.id, node.id)
      for (const connection of [
        new ClassicPreset.Connection(inputs, 'parameter:n', compare, 'a'),
        new ClassicPreset.Connection(zero, 'value', compare, 'b'),
        new ClassicPreset.Connection(inputs, 'parameter:n', decrement, 'a'),
        new ClassicPreset.Connection(decrement, 'value', call, 'parameter:n'),
        new ClassicPreset.Connection(compare, 'value', conditional, 'condition'),
        new ClassicPreset.Connection(literal, 'value', conditional, 'true'),
        new ClassicPreset.Connection(call, 'value', conditional, 'false'),
        new ClassicPreset.Connection(conditional, 'result', output, 'result'),
      ]) await editor.addConnection(connection as Schemes['Connection'])
    }
    await build(odd, even, false)
    await build(even, odd, true)

    expect(await evaluateOpenSCAD(editor, engine, undefined, definitions)).toBe(
      'function is_odd(n = 5) = ((n == 0) ? false : is_even(n = (n - 1)));\n\nfunction is_even(n = 6) = ((n == 0) ? true : is_odd(n = (n - 1)));',
    )
  })

  it('does not emit a disconnected recursive-looking Call in a Function body', async () => {
    const { editor, engine } = graph()
    const definitions = new DefinitionRegistry()
    const definition = { id: 'stable', kind: 'function' as const, name: 'stable', inputsNodeId: 'stable-in', outputNodeId: 'stable-out', parameters: [], resultType: 'number' as const }
    definitions.add(definition)
    const inputs = new FunctionInputsNode(); inputs.id = definition.inputsNodeId
    const output = new FunctionOutputNode('number'); output.id = definition.outputNodeId
    const value = new NumberNode({ value: 7, name: 'Seven' }); value.id = 'stable-value'
    const deadSelfCall = new FunctionCallNode(definition, { definitionId: definition.id }); deadSelfCall.id = 'dead-self-call'
    for (const node of [inputs, output, value, deadSelfCall]) await editor.addNode(node)
    definitions.assignNode(definition.id, value.id)
    definitions.assignNode(definition.id, deadSelfCall.id)
    await editor.addConnection(new ClassicPreset.Connection(value, 'value', output, 'result') as Schemes['Connection'])

    expect(await evaluateOpenSCAD(editor, engine, undefined, definitions)).toBe('function stable() = 7;')
  })

  it('emits Functions before Modules and Main, and omits an unresolved Function entirely', async () => {
    const { editor, engine } = graph()
    const definitions = new DefinitionRegistry()
    const resolved = { ...functionDefinition(), resultType: 'number' as const }
    const unresolved = { id: 'fn-draft', kind: 'function' as const, name: 'draft', inputsNodeId: 'fn-draft-inputs', outputNodeId: 'fn-draft-output', parameters: [] }
    const moduleDefinition: ModuleDefinition = { id: 'mod-wheel', kind: 'module', name: 'wheel', inputsNodeId: 'wheel-inputs', outputNodeId: 'wheel-output', parameters: [], geometryInputs: [{ id: 'g1', name: 'Geometry 1' }] }
    definitions.add(resolved); definitions.add(unresolved); definitions.add(moduleDefinition)
    const fnInputs = new FunctionInputsNode(resolved.parameters); fnInputs.id = resolved.inputsNodeId
    const fnOutput = new FunctionOutputNode('number'); fnOutput.id = resolved.outputNodeId
    const draftInputs = new FunctionInputsNode(); draftInputs.id = unresolved.inputsNodeId
    const draftOutput = new FunctionOutputNode(); draftOutput.id = unresolved.outputNodeId
    const modInputs = new ModuleInputsNode([], moduleDefinition.geometryInputs); modInputs.id = moduleDefinition.inputsNodeId
    const modOutput = new ModuleOutputNode(); modOutput.id = moduleDefinition.outputNodeId
    const numberNode = new NumberNode({ value: 42, name: 'n' }); numberNode.id = 'literal-42'
    const cube = new CubeNode(); cube.id = 'main-cube'
    for (const node of [fnInputs, fnOutput, draftInputs, draftOutput, modInputs, modOutput, numberNode, cube]) await editor.addNode(node)
    await editor.addConnection(new ClassicPreset.Connection(numberNode, 'value', fnOutput, 'result') as Schemes['Connection'])

    const source = await evaluateOpenSCAD(editor, engine, undefined, definitions)
    expect(source.indexOf('function double_size')).toBeGreaterThanOrEqual(0)
    expect(source.indexOf('function double_size')).toBeLessThan(source.indexOf('module wheel'))
    expect(source.indexOf('module wheel')).toBeLessThan(source.indexOf('cube(10)'))
    expect(source).not.toContain('draft')
  })

  it('emits a Function Call and a Module Call nested in a Module in callee-before-caller order', async () => {
    const { editor, engine } = graph()
    const definitions = new DefinitionRegistry()
    const outer: ModuleDefinition = { id: 'mod-outer', kind: 'module', name: 'outer', inputsNodeId: 'outer-in', outputNodeId: 'outer-out', parameters: [{ id: 'r', name: 'r', type: 'number', default: 10 }], geometryInputs: [] }
    const inner: ModuleDefinition = { id: 'mod-inner', kind: 'module', name: 'inner', inputsNodeId: 'inner-in', outputNodeId: 'inner-out', parameters: [{ id: 'r', name: 'r', type: 'number', default: 10 }], geometryInputs: [] }
    const diameter: ModuleDefinition = { id: 'fn-diameter', kind: 'function', name: 'diameter', inputsNodeId: 'diameter-in', outputNodeId: 'diameter-out', parameters: [{ id: 'r', name: 'r', type: 'number', default: 10 }], resultType: 'number' }
    // Reverse dependency order proves the effective dependency pass, rather
    // than registry order, controls declarations.
    definitions.add(outer); definitions.add(inner); definitions.add(diameter)
    const outerInputs = new ModuleInputsNode(outer.parameters); outerInputs.id = outer.inputsNodeId
    const outerOutput = new ModuleOutputNode(); outerOutput.id = outer.outputNodeId
    const innerInputs = new ModuleInputsNode(inner.parameters); innerInputs.id = inner.inputsNodeId
    const innerOutput = new ModuleOutputNode(); innerOutput.id = inner.outputNodeId
    const diameterInputs = new FunctionInputsNode(diameter.parameters); diameterInputs.id = diameter.inputsNodeId
    const diameterOutput = new FunctionOutputNode('number'); diameterOutput.id = diameter.outputNodeId
    const double = new ArithmeticNode({ operation: 'multiplication', a: 0, b: 2 }); double.id = 'double'
    const innerCube = new CubeNode(); innerCube.id = 'inner-cube'
    const functionCall = new FunctionCallNode(diameter, { definitionId: diameter.id }); functionCall.id = 'outer-diameter'
    const moduleCall = new ModuleCallNode(inner, { definitionId: inner.id }); moduleCall.id = 'outer-inner'
    const mainCall = new ModuleCallNode(outer, { definitionId: outer.id }); mainCall.id = 'main-outer'
    for (const node of [outerInputs, outerOutput, innerInputs, innerOutput, diameterInputs, diameterOutput, double, innerCube, functionCall, moduleCall, mainCall]) await editor.addNode(node)
    definitions.assignNode(diameter.id, double.id)
    definitions.assignNode(inner.id, innerCube.id)
    definitions.assignNode(outer.id, functionCall.id)
    definitions.assignNode(outer.id, moduleCall.id)
    await editor.addConnection(new ClassicPreset.Connection(diameterInputs, 'parameter:r', double, 'a') as Schemes['Connection'])
    await editor.addConnection(new ClassicPreset.Connection(double, 'value', diameterOutput, 'result') as Schemes['Connection'])
    await editor.addConnection(new ClassicPreset.Connection(innerInputs, 'parameter:r', innerCube, 'size') as Schemes['Connection'])
    await editor.addConnection(new ClassicPreset.Connection(innerCube, 'geometry', innerOutput, 'geometry') as Schemes['Connection'])
    await editor.addConnection(new ClassicPreset.Connection(outerInputs, 'parameter:r', functionCall, 'parameter:r') as Schemes['Connection'])
    await editor.addConnection(new ClassicPreset.Connection(functionCall, 'value', moduleCall, 'parameter:r') as Schemes['Connection'])
    await editor.addConnection(new ClassicPreset.Connection(moduleCall, 'geometry', outerOutput, 'geometry') as Schemes['Connection'])

    expect(await evaluateOpenSCAD(editor, engine, undefined, definitions)).toBe('function diameter(r = 10) = (r * 2);\n\nmodule inner(r = 10) {\n  cube(r);\n}\n\nmodule outer(r = 10) {\n  inner(r = diameter(r = r));\n}\n\nouter(r = 10);')
  })

  it('resolves a Function Output connection to an existing FunctionOutputNode-compatible source even while typed differently on the wildcard target port', async () => {
    const editor = new NodeEditor<Schemes>()
    const registry = new DefinitionRegistry()
    bindDefinitionRegistry(editor, registry)
    const definition = functionDefinition()
    registry.add(definition)
    const number = new NumberNode({ value: 1, name: 'n' })
    const boolean = new BooleanNode({ value: true, name: 'b' })
    const output = new FunctionOutputNode(); output.id = definition.outputNodeId
    const cube = new CubeNode()
    for (const node of [number, boolean, output, cube]) await editor.addNode(node)
    // A real Number/Boolean source lives inside the Function's own scope
    // (built between its Inputs/Output, like Module bodies); ordinary wires
    // never cross a definition boundary regardless of this port's special
    // type-acceptance rule.
    registry.assignNode(definition.id, number.id)
    registry.assignNode(definition.id, boolean.id)
    // Function Output's port is a deliberate exception to the generic
    // diagonal-only rule: reachable for Number/Boolean/Vector3 regardless of
    // its own currently nominal socket (`editor.ts` runs the actual
    // resolve/replace/confirm decision; this is the compatibility predicate
    // it depends on staying permissive here).
    expect(canConnectSocketData(editor, { nodeId: number.id, key: 'value', side: 'output' }, { nodeId: output.id, key: 'result', side: 'input' })).toBe(true)
    expect(canConnectSocketData(editor, { nodeId: boolean.id, key: 'value', side: 'output' }, { nodeId: output.id, key: 'result', side: 'input' })).toBe(true)
    expect(canConnectSocketData(editor, { nodeId: cube.id, key: 'geometry', side: 'output' }, { nodeId: output.id, key: 'result', side: 'input' })).toBe(false)
  })

  it('allows transferring a Function Call into Function and Module scopes', async () => {
    const editor = new NodeEditor<Schemes>()
    const registry = new DefinitionRegistry()
    const definition = { ...functionDefinition(), resultType: 'number' as const }
    const moduleDefinition: ModuleDefinition = { id: 'mod-wheel', kind: 'module', name: 'wheel', inputsNodeId: 'wheel-inputs', outputNodeId: 'wheel-output', parameters: [], geometryInputs: [] }
    registry.add(definition)
    registry.add(moduleDefinition)
    const call = new FunctionCallNode(definition, { definitionId: definition.id }); call.id = 'fn-call-1'
    await editor.addNode(call)
    expect(scopeTransferProblem(editor, registry, [call.id], definition.id)).toBeNull()
    expect(scopeTransferProblem(editor, registry, [call.id], moduleDefinition.id)).toBeNull()
    expect(scopeTransferProblem(editor, registry, [call.id], null)).toBeNull()
  })

  it('rejects transferring a Geometry/Module-Call node into a Function scope', async () => {
    const editor = new NodeEditor<Schemes>()
    const registry = new DefinitionRegistry()
    const definition = functionDefinition()
    registry.add(definition)
    const cube = new CubeNode(); cube.id = 'cube-1'
    await editor.addNode(cube)
    expect(scopeTransferProblem(editor, registry, [cube.id], definition.id)).toBe('function-incompatible')

    const moduleDefinition: ModuleDefinition = { id: 'mod-wheel', kind: 'module', name: 'wheel', inputsNodeId: 'wheel-inputs', outputNodeId: 'wheel-output', parameters: [], geometryInputs: [] }
    registry.add(moduleDefinition)
    const call = new ModuleCallNode(moduleDefinition); call.id = 'call-1'
    await editor.addNode(call)
    expect(scopeTransferProblem(editor, registry, [call.id], definition.id)).toBe('module-call')

    const number = new NumberNode(); number.id = 'number-1'
    await editor.addNode(number)
    expect(scopeTransferProblem(editor, registry, [number.id], definition.id)).toBeNull()
    for (const node of [new ArithmeticNode(), new TrigonometryNode(), new BasicMathNode(), new ExponentialLogNode()]) {
      await editor.addNode(node)
      expect(scopeTransferProblem(editor, registry, [node.id], definition.id)).toBeNull()
    }
  })

  it('renames by stable id and preserves Call references', () => {
    const registry = new DefinitionRegistry()
    const definition = functionDefinition()
    registry.add(definition)
    expect(registry.rename(definition.id, 'twice')).toBe(true)
    expect(registry.get(definition.id)?.name).toBe('twice')
    expect(registry.get(definition.id)?.id).toBe(definition.id)
  })

  it('removes the entire owned scope on deletion, leaving other definitions untouched', () => {
    const registry = new DefinitionRegistry()
    const definition = functionDefinition()
    const other: ModuleDefinition = { id: 'mod-other', kind: 'module', name: 'other', inputsNodeId: 'other-inputs', outputNodeId: 'other-output', parameters: [], geometryInputs: [] }
    registry.add(definition)
    registry.add(other)
    registry.remove(definition.id)
    expect(registry.get(definition.id)).toBeUndefined()
    expect(registry.get(other.id)).toBeDefined()
  })

  it('setResultType only operates on Function definitions', () => {
    const registry = new DefinitionRegistry()
    const moduleDefinition: ModuleDefinition = { id: 'mod-wheel', kind: 'module', name: 'wheel', inputsNodeId: 'wheel-inputs', outputNodeId: 'wheel-output', parameters: [], geometryInputs: [] }
    registry.add(moduleDefinition)
    expect(() => registry.setResultType(moduleDefinition.id, 'number')).toThrow('is not a Function')
    const definition = functionDefinition()
    registry.add(definition)
    registry.setResultType(definition.id, 'boolean')
    expect(registry.get(definition.id)?.resultType).toBe('boolean')
    registry.setResultType(definition.id, undefined)
    expect(registry.get(definition.id)?.resultType).toBeUndefined()
  })
})

import type { NodeEditor } from 'rete'
import type { DataflowEngine } from 'rete-engine'

import type { BooleanValue, GeometryValue, NumberValue, Vector3Value } from './sockets'
import type { Schemes } from './schemes'
import type { DefinitionRegistry, ModuleDefinition, ModuleParameter, ModuleParameterDefault } from './definitions'
import { analyzeFunctionDependencies } from './function-dependencies'
import { FunctionCallNode } from './nodes/function-call-node'
import { ModuleCallNode } from './nodes/module-call-node'
import { ConditionalNode } from './nodes/value-nodes'
import { IfNode } from './nodes/if-node'
import { ScadSettingsNode, type ScadSettingsValue } from './nodes/scad-settings-node'
import { t } from '../i18n/translate'
import { isValueBindingNode, resolveBindingInScope } from './bindings'
import { VariableReferenceNode } from './nodes/variable-reference-node'

/**
 * Evaluates the graph into a single OpenSCAD source string: one statement
 * per "root" node, where a root is a node whose `geometry` output isn't
 * consumed by another node's input. With no transformation/CSG nodes yet,
 * every node is currently a root, so each simply becomes an independent
 * top-level object - which is already valid, meaningful OpenSCAD.
 *
 * `rootNodeId`, when given, switches to the Inspect Node feature's mode:
 * instead of every unconsumed node, exactly that one node is evaluated as
 * the sole output root, reusing the same recursive `rete-engine` dataflow
 * fetch each of its upstream dependencies already goes through for a
 * normal evaluation - the graph itself, and its normal (non-rooted)
 * evaluation, are never mutated or otherwise affected by this. Returns
 * `''` if the id no longer refers to a node (e.g. it was just deleted).
 */
export async function evaluateOpenSCAD(
  editor: NodeEditor<Schemes>,
  engine: DataflowEngine<Schemes>,
  rootNodeId?: string,
  definitions?: DefinitionRegistry,
): Promise<string> {
  if (rootNodeId !== undefined) {
    if (!editor.getNode(rootNodeId)) return ''
    const scope = definitions?.scopeOf(rootNodeId)
    const scopedSettings = settingsNodeInScope(editor, scope ?? null, definitions)
    assertNoIncompleteReachableBranch(editor, [rootNodeId, ...(scopedSettings ? [scopedSettings.id] : [])])
    const settings = await evaluateScopeSettings(editor, engine, scope ?? null, definitions)
    const variables = await evaluateScopeVariables(editor, engine, scope ?? null, definitions)
    const source = await evaluateGeometryRoot(engine, rootNodeId)
    const definition = scope ? definitions?.get(scope) : undefined
    if (definition) return inspectModuleSource(definition, joinScopeSource(variables.statements, settings, source))
    const main = joinScopeSource(variables.statements, settings, source)
    return definitions ? joinDefinitions(await evaluateDefinitions(editor, engine, definitions), main) : main
  }

  const mainNodeIds = new Set(editor.getNodes()
    .filter((node) => (definitions?.scopeOf(node.id) ?? null) === null)
    .map((node) => node.id))
  const consumedNodeIds = new Set(editor.getConnections()
    .filter((connection) => mainNodeIds.has(connection.source) && mainNodeIds.has(connection.target))
    .map((connection) => connection.source))
  const roots = editor.getNodes().filter((node) =>
    mainNodeIds.has(node.id) && !consumedNodeIds.has(node.id) && !(node instanceof ScadSettingsNode),
  )
  const mainSettings = settingsNodeInScope(editor, null, definitions)
  assertNoIncompleteReachableBranch(editor, [
    ...(mainSettings ? [mainSettings.id] : []),
    ...roots
    .filter((node) => Boolean(node.outputs.geometry))
    // An untouched If draft has no upstream program edges and emits no
    // source. Treating it as a Main root merely because its output is
    // unconsumed would make harmless palette drafts block Render. Once any
    // semantic input is wired (or Inspect explicitly roots it), it becomes
    // effective and receives the normal completeness check below.
    .filter((node) => !(node instanceof IfNode) || editor.getConnections().some((connection) => connection.target === node.id))
    .map((node) => node.id),
  ])

  const fragments: string[] = []
  for (const node of roots) {
    engine.reset()
    const output = (await engine.fetch(node.id)) as { geometry?: GeometryValue }
    // Incomplete disconnected Geometry If drafts intentionally evaluate to
    // an empty fragment. Keep them absent from Main rather than introducing
    // a phantom trailing separator/source statement.
    if (output.geometry?.code) fragments.push(output.geometry.code)
  }

  const settings = await evaluateScopeSettings(editor, engine, null, definitions)
  const variables = await evaluateScopeVariables(editor, engine, null, definitions)
  const main = joinScopeSource(variables.statements, settings, fragments.join('\n'))
  return definitions ? joinDefinitions(await evaluateDefinitions(editor, engine, definitions), main) : main
}

async function evaluateGeometryRoot(engine: DataflowEngine<Schemes>, nodeId: string, outputKey = 'geometry'): Promise<string> {
  engine.reset()
  const output = (await engine.fetch(nodeId)) as Record<string, GeometryValue | undefined>
  return output[outputKey]?.code ?? ''
}

/** Module bodies reuse ordinary upstream Geometry evaluation. Output is a
 * sink/root marker, not an OpenSCAD-producing node, so follow its one input
 * to the existing Geometry producer. The source's own output port key must
 * be used (not a hardcoded `geometry`) since a Module Inputs Geometry input
 * feeding Output directly exposes its value under a dynamic `geometry:<id>`
 * key, not `geometry`. */
async function evaluateModuleBody(editor: NodeEditor<Schemes>, engine: DataflowEngine<Schemes>, definition: ModuleDefinition, definitions: DefinitionRegistry): Promise<string> {
  const connection = editor.getConnections().find((item) => item.target === definition.outputNodeId && item.targetInput === 'geometry')
  const settings = await evaluateScopeSettings(editor, engine, definition.id, definitions)
  const variables = await evaluateScopeVariables(editor, engine, definition.id, definitions)
  const geometry = connection ? await evaluateGeometryRoot(engine, connection.source, connection.sourceOutput) : ''
  return joinScopeSource(variables.statements, settings, geometry)
}

/** A Function's single expression is whatever ordinary value dataflow feeds
 * its Output's `result` input - reusing the exact same recursive fetch as
 * Geometry evaluation, just rooted at a value-typed output key. Returns
 * `''` when nothing is connected (an unresolved draft, never emitted). */
async function evaluateFunctionBody(editor: NodeEditor<Schemes>, engine: DataflowEngine<Schemes>, definition: ModuleDefinition, definitions: DefinitionRegistry): Promise<string> {
  const connection = editor.getConnections().find((item) => item.target === definition.outputNodeId && item.targetInput === 'result')
  if (!connection) return ''
  const expression = await evaluateGeometryRoot(engine, connection.source, connection.sourceOutput)
  const variables = await evaluateScopeVariables(editor, engine, definition.id, definitions)
  return variables.expressions.length > 0 ? `let(${variables.expressions.join(', ')}) ${expression}` : expression
}

/** Functions are emitted before Modules and Main (AGENTS.md Milestone 8
 * Phase 7, section 8) so generated source stays ready for Phase 8's
 * cross-definition dependencies. An unresolved Function is a valid editor
 * draft and is never emitted as a usable declaration. */
async function evaluateDefinitions(editor: NodeEditor<Schemes>, engine: DataflowEngine<Schemes>, definitions: DefinitionRegistry): Promise<string> {
  const fragments: string[] = []
  const allDefinitions = definitions.list()
  assertNoIncompleteReachableBranch(editor, [
    ...allDefinitions.map((definition) => definition.outputNodeId),
    ...editor.getNodes().filter((node) => node instanceof ScadSettingsNode).map((node) => node.id),
  ])
  const analysis = analyzeFunctionDependencies(
    allDefinitions.map((definition) => ({ id: definition.id, kind: definition.kind, outputNodeId: definition.outputNodeId })),
    editor.getNodes().map((node) => ({
      id: node.id,
      scope: definitions.scopeOf(node.id),
      ...(node instanceof FunctionCallNode ? { calledFunctionId: node.definitionId } : {}),
      ...(node instanceof ModuleCallNode ? { calledModuleId: node.definitionId } : {}),
    })),
    editor.getConnections(),
  )
  const definitionsById = new Map(allDefinitions.map((definition) => [definition.id, definition]))
  for (const definitionId of analysis.order) {
    const definition = definitionsById.get(definitionId)!
    if (definition.kind !== 'function' || definition.resultType === undefined) continue
    const body = await evaluateFunctionBody(editor, engine, definition, definitions)
    fragments.push(`function ${definition.name}(${moduleParameterDeclaration(definition.parameters ?? [])}) = ${body || 'undef'};`)
  }
  for (const definitionId of analysis.moduleOrder) {
    const definition = definitionsById.get(definitionId)!
    const body = await evaluateModuleBody(editor, engine, definition, definitions)
    const indented = body ? `\n${body.split('\n').map((line) => `  ${line}`).join('\n')}\n` : '\n'
    fragments.push(`module ${definition.name}(${moduleParameterDeclaration(definition.parameters ?? [])}) {${indented}}`)
  }
  return fragments.join('\n\n')
}

/** Conditional values deliberately have no fallback literal. Before any
 * source generation, walk only the effective upstream graph roots so a dead
 * drafting node remains harmless while an expression that reaches Main or a
 * definition body gets one clear localized failure instead of `undef`. */
function assertNoIncompleteReachableBranch(editor: NodeEditor<Schemes>, roots: readonly string[]): void {
  const incoming = new Map<string, string[]>()
  for (const connection of editor.getConnections()) {
    const list = incoming.get(connection.target) ?? []
    list.push(connection.source)
    incoming.set(connection.target, list)
  }
  const seen = new Set<string>()
  const pending = [...roots]
  while (pending.length > 0) {
    const id = pending.pop()!
    if (seen.has(id)) continue
    seen.add(id)
    const node = editor.getNode(id)
    if (node instanceof ConditionalNode) {
      const connected = new Set(editor.getConnections().filter((item) => item.target === id).map((item) => item.targetInput))
      if (node.getValueType() === undefined || !connected.has('condition') || !connected.has('true') || !connected.has('false')) {
        throw new Error(t('conditional.incomplete'))
      }
    }
    if (node instanceof IfNode) {
      const connected = new Set(editor.getConnections().filter((item) => item.target === id).map((item) => item.targetInput))
      if (!connected.has('condition') || !connected.has('then')) throw new Error(t('if.incomplete'))
    }
    pending.push(...(incoming.get(id) ?? []))
  }
}

function joinDefinitions(definitions: string, main: string): string {
  if (!definitions) return main
  return main ? `${definitions}\n\n${main}` : definitions
}

function settingsNodeInScope(
  editor: NodeEditor<Schemes>,
  scope: string | null,
  definitions?: DefinitionRegistry,
): ScadSettingsNode | undefined {
  return editor.getNodes().find((node): node is ScadSettingsNode =>
    node instanceof ScadSettingsNode && (definitions?.scopeOf(node.id) ?? null) === scope,
  )
}

async function evaluateScopeSettings(
  editor: NodeEditor<Schemes>,
  engine: DataflowEngine<Schemes>,
  scope: string | null,
  definitions?: DefinitionRegistry,
): Promise<string> {
  const node = settingsNodeInScope(editor, scope, definitions)
  if (!node) return ''
  engine.reset()
  const output = (await engine.fetch(node.id)) as { settings?: ScadSettingsValue }
  return output.settings?.code ?? ''
}

function joinScopeSource(...parts: string[]): string {
  return parts.filter(Boolean).join('\n')
}

interface EvaluatedVariables {
  expressions: string[]
  statements: string
}

/** Named Value definitions are explicit scope roots. A reference contributes
 * an identifier expression, while this pass emits each definition exactly
 * once in dependency-safe order even though no artificial Rete wire joins the
 * compact reference back to its definition. */
async function evaluateScopeVariables(
  editor: NodeEditor<Schemes>,
  engine: DataflowEngine<Schemes>,
  scope: string | null,
  definitions?: DefinitionRegistry,
): Promise<EvaluatedVariables> {
  for (const reference of editor.getNodes().filter((node): node is VariableReferenceNode => node instanceof VariableReferenceNode)) {
    if ((definitions?.scopeOf(reference.id) ?? null) !== scope) continue
    const binding = resolveBindingInScope(editor, definitions, reference.bindingId, scope)
    if (!binding) throw new Error(t('variable.invalidScope'))
    reference.syncBinding(binding)
  }
  const bindings = editor.getNodes().filter(isValueBindingNode)
    .filter((node) => node.getBindingId() && (definitions?.scopeOf(node.id) ?? null) === scope)
  const byBindingId = new Map(bindings.map((node) => [node.getBindingId()!, node]))
  const incoming = new Map<string, string[]>()
  for (const edge of editor.getConnections()) incoming.set(edge.target, [...(incoming.get(edge.target) ?? []), edge.source])
  const dependencies = new Map<string, Set<string>>()
  for (const node of bindings) {
    const found = new Set<string>()
    const seen = new Set<string>()
    const pending = [...(incoming.get(node.id) ?? [])]
    while (pending.length > 0) {
      const id = pending.pop()!
      if (seen.has(id)) continue
      seen.add(id)
      const upstream = editor.getNode(id)
      if (upstream instanceof VariableReferenceNode) found.add(upstream.bindingId)
      pending.push(...(incoming.get(id) ?? []))
    }
    dependencies.set(node.getBindingId()!, found)
  }
  const ordered: typeof bindings = []
  const visiting = new Set<string>()
  const visited = new Set<string>()
  const visit = (bindingId: string): void => {
    if (visiting.has(bindingId)) throw new Error(t('variable.circularDependency'))
    if (visited.has(bindingId)) return
    visiting.add(bindingId)
    for (const dependency of dependencies.get(bindingId) ?? []) if (byBindingId.has(dependency)) visit(dependency)
    visiting.delete(bindingId)
    visited.add(bindingId)
    ordered.push(byBindingId.get(bindingId)!)
  }
  for (const node of bindings) visit(node.getBindingId()!)

  const expressions: string[] = []
  for (const node of ordered) {
    engine.reset()
    const output = (await engine.fetch(node.id)) as { value?: NumberValue | BooleanValue | Vector3Value }
    if (!output.value) throw new Error(`Variable "${node.getBindingName()}" has no value.`)
    expressions.push(`${node.getBindingName()} = ${output.value.code}`)
  }
  return { expressions, statements: expressions.map((assignment) => `${assignment};`).join('\n') }
}

export type InspectEvaluation =
  | { kind: 'geometry'; source: string }
  | { kind: 'value'; expression: string; source?: string }
  | { kind: 'missing' }

/** Evaluates one explicitly inspected node while retaining the ordinary
 * geometry-only full-model evaluator above. Values are expressions that are
 * subsequently evaluated by OpenSCAD (via `echo()` in the worker), never by
 * TypeScript. */
export async function evaluateInspectNode(
  editor: NodeEditor<Schemes>,
  engine: DataflowEngine<Schemes>,
  nodeId: string,
  definitions?: DefinitionRegistry,
): Promise<InspectEvaluation> {
  const node = editor.getNode(nodeId)
  if (!node) return { kind: 'missing' }
  engine.reset()
  if (node.outputs.geometry) return { kind: 'geometry', source: await evaluateOpenSCAD(editor, engine, nodeId, definitions) }
  const output = (await engine.fetch(nodeId)) as { value?: NumberValue | BooleanValue | Vector3Value }
  if (!output.value) return { kind: 'missing' }
  const scope = definitions?.scopeOf(nodeId)
  const definition = scope ? definitions?.get(scope) : undefined
  const echo = `echo("__SCADLET_VALUE__:", ${output.value.code});`
  const settings = await evaluateScopeSettings(editor, engine, scope ?? null, definitions)
  const variables = await evaluateScopeVariables(editor, engine, scope ?? null, definitions)
  return definition
    ? { kind: 'value', expression: output.value.code, source: definitions
      ? joinDefinitions(await evaluateDefinitions(editor, engine, definitions), inspectModuleSource(definition, joinScopeSource(variables.statements, settings, echo)))
      : inspectModuleSource(definition, joinScopeSource(variables.statements, settings, echo)) }
    : definitions
      ? { kind: 'value', expression: output.value.code, source: joinDefinitions(await evaluateDefinitions(editor, engine, definitions), joinScopeSource(variables.statements, settings, echo)) }
      : { kind: 'value', expression: output.value.code }
}

function moduleParameterDeclaration(parameters: readonly ModuleParameter[]): string {
  return parameters.map((parameter) => `${parameter.name} = ${moduleParameterLiteral(parameter.default)}`).join(', ')
}

function moduleParameterLiteral(value: ModuleParameterDefault): string {
  return Array.isArray(value) ? `[${value.join(', ')}]` : String(value)
}

/** An internal Module node has no call instance. Inspect therefore creates a
 * collision-resistant, default-argument wrapper instead of substituting
 * defaults into its expressions in JavaScript. */
function inspectModuleSource(definition: ModuleDefinition, body: string): string {
  const name = `__scadlet_inspect_${definition.id.replace(/[^A-Za-z0-9_]/g, '_')}`
  const indented = body ? `\n${body.split('\n').map((line) => `  ${line}`).join('\n')}\n` : '\n'
  return `module ${name}(${moduleParameterDeclaration(definition.parameters ?? [])}) {${indented}}\n\n${name}();`
}

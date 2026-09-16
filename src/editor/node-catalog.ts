import type { ClassicPreset } from 'rete'

import type { Schemes } from './schemes'
import { CubeNode } from './nodes/cube-node'
import { CylinderNode } from './nodes/cylinder-node'
import { DifferenceNode } from './nodes/difference-node'
import { IntersectionNode } from './nodes/intersection-node'
import { RotateNode } from './nodes/rotate-node'
import { ScaleNode } from './nodes/scale-node'
import { SphereNode } from './nodes/sphere-node'
import { TranslateNode } from './nodes/translate-node'
import { UnionNode } from './nodes/union-node'
import { IfNode } from './nodes/if-node'
import { ArithmeticNode, BasicMathNode, BooleanNode, CompareNode, ConditionalNode, ExponentialLogNode, NumberNode, TrigonometryNode, Vector3Node, validateArithmeticParams, validateBasicMathParams, validateBooleanParams, validateCompareParams, validateConditionalParams, validateExponentialLogParams, validateNumberParams, validateTrigonometryParams, validateVector3ValueParams, type TrigonometryOperation } from './nodes/value-nodes'
import { type VariadicBooleanParams } from './nodes/boolean-op-node'
import { validateCubeParams } from '../openscad/cube'
import { validateCylinderParams } from '../openscad/cylinder'
import { validateSphereParams } from '../openscad/sphere'
import { validateVector3Params } from '../openscad/transform'
import type { CubeParams } from '../openscad/cube'
import type { CylinderParams } from '../openscad/cylinder'
import type { SphereParams } from '../openscad/sphere'
import type { Vector3Params } from '../openscad/transform'
import type { SocketType } from './sockets'
import { ModuleInputsNode, ModuleOutputNode } from './nodes/module-interface-nodes'
import { ModuleCallNode, type ModuleCallParams } from './nodes/module-call-node'
import { FunctionInputsNode, FunctionOutputNode } from './nodes/function-interface-nodes'
import { FunctionCallNode, type FunctionCallParams } from './nodes/function-call-node'
import { ScadSettingsNode } from './nodes/scad-settings-node'
import { VariableReferenceNode, validateVariableReferenceParams, type VariableBindingResolution } from './nodes/variable-reference-node'
import { validateScadSettingsParams, type ScadSettingsParams } from '../openscad/settings'
import type { ModuleDefinition, ModuleParameterDefault } from './definitions'
import type { CompactIconName } from '../components/icons'

/** MIME type used to carry a node-catalog `type` id through native HTML drag-and-drop (see `node-palette.ts`/`node-editor.ts`). */
export const NODE_DRAG_MIME_TYPE = 'application/x-scadlet-node-type'
/** Optional validated creation parameters accompanying a static catalog
 * drag. This keeps palette-selected operations part of construction rather
 * than mutating an arbitrary default node after it has entered the graph. */
export const NODE_DRAG_PARAMS_MIME_TYPE = 'application/x-scadlet-node-parameters'
/** Carries a stable project definition ID for dynamic Module Call palette
 * entries. This intentionally differs from static catalog node types. */
export const MODULE_CALL_DRAG_MIME_TYPE = 'application/x-scadlet-module-call'
/** The Function Call counterpart of `MODULE_CALL_DRAG_MIME_TYPE`. Kept as a
 * distinct MIME type since it resolves to a different generic node type. */
export const FUNCTION_CALL_DRAG_MIME_TYPE = 'application/x-scadlet-function-call'
/** Stable binding and source-node ids carried by the icon-only reference-creation drag. */
export const VARIABLE_REFERENCE_DRAG_MIME_TYPE = 'application/x-scadlet-variable-reference'

/**
 * Stable, language-independent category ids. Display text lives in
 * `src/i18n/translate.ts`, looked up via each category's `labelKey` -
 * never derive UI copy from these ids directly.
 */
export type NodeCategoryId = 'primitives' | 'transformations' | 'boolean-operations' | 'control-flow' | 'settings' | 'values' | 'math'

export type NodeGraphScopeKind = 'main' | 'module' | 'function'

/** Stable, language-independent node-type ids (also the drag payload and click-fallback argument). */
export type NodeTypeId =
  | 'cube'
  | 'cylinder'
  | 'sphere'
  | 'translate'
  | 'rotate'
  | 'scale'
  | 'difference'
  | 'union'
  | 'intersection'
  | 'number'
  | 'boolean'
  | 'vector3'
  | 'arithmetic'
  | 'trigonometry'
  | 'basic-math'
  | 'exponential-log'
  | 'compare'
  | 'conditional'
  | 'if'
  | 'scad-settings'
  | 'module-inputs'
  | 'module-output'
  | 'module-call'
  | 'function-inputs'
  | 'function-output'
  | 'function-call'
  | 'variable-reference'

/**
 * The node-family icon shown at the far left of a node's header (and
 * immediately before its palette label) - node-style.md's "coherent
 * family" requirement. Kept as one small closed lookup table (not a
 * per-node-class method) so the palette (which only ever has a catalog
 * entry, never a live node instance) and the live-node renderer (which
 * resolves a type via `identifyNodeType`) share exactly one mapping.
 */
const NODE_TYPE_ICON: Record<NodeTypeId, CompactIconName> = {
  cube: 'cube',
  cylinder: 'cylinder',
  sphere: 'sphere',
  translate: 'translate',
  rotate: 'rotate',
  scale: 'scale',
  difference: 'difference',
  union: 'union',
  intersection: 'intersection',
  number: 'value',
  boolean: 'value',
  vector3: 'value',
  arithmetic: 'math',
  trigonometry: 'math',
  'basic-math': 'math',
  'exponential-log': 'math',
  compare: 'compare',
  conditional: 'conditional',
  if: 'conditional',
  'scad-settings': 'settings',
  'module-inputs': 'input-port',
  'module-output': 'output-port',
  'module-call': 'module',
  'function-inputs': 'input-port',
  'function-output': 'output-port',
  'function-call': 'function',
  'variable-reference': 'reference',
}

/** Falls back to the neutral value icon for a node the catalog doesn't
 * recognize (should not happen for a live catalog-created node, but keeps
 * this total rather than throwing for e.g. a hand-built test node). */
export function nodeTypeIcon(type: NodeTypeId | undefined): CompactIconName {
  return type ? NODE_TYPE_ICON[type] : 'value'
}

export interface NodeCategory {
  readonly id: NodeCategoryId
  readonly labelKey: string
}

export interface NodeCreationContext {
  /** Re-renders a node after its dynamic control set changes (e.g. Cylinder's size mode) - see `editor.ts`. */
  onControlsChanged(nodeId: string): void
  /**
   * Called whenever any of this node's controls' values change (see
   * `wireDirtyNotifications` below) - marks the project dirty on any
   * persisted-parameter edit. Optional so callers that don't care about
   * dirty tracking (e.g. tests constructing nodes directly) don't need
   * to supply it.
   */
  notifyDirty?(): void
  /** Whether a representation-changing node may replace its currently
   * active parameter ports. Returning false protects live connections from
   * becoming hidden even if a caller bypasses the disabled DOM selector. */
  canRemoveInputs?(nodeId: string, inputKeys: readonly string[]): boolean
  /** Row-level parameter/form removal (node-style.md "Remove parameter"):
   * confirms and disconnects any wires attached to `inputKeys` (using the
   * established concise confirmation flow) before the node removes its own
   * ports/controls. Resolves `false` when the user cancels. */
  requestRemoveForm?(nodeId: string, inputKeys: readonly string[], label: string): Promise<boolean>
  /** Resolves a project-owned Module by its stable ID while constructing a
   * generic `module-call`; absent in DOM-free tests that never create calls. */
  getModuleDefinition?(definitionId: string): ModuleDefinition | undefined
  /** Runs the one dynamic Math signature transition through the editor's
   * connection-safe, confirmation-aware lifecycle. */
  requestTrigonometryOperationChange?(nodeId: string, operation: TrigonometryOperation): Promise<boolean>
  /** Resolves a reference strictly in the scope where it is being restored. */
  resolveVariableBinding?(bindingId: string): VariableBindingResolution | undefined
}

export interface PaletteOperationChoice {
  readonly value: string
  readonly label: string
}

export interface PaletteOperationConfig {
  readonly accessibleLabelKey: string
  readonly options: readonly PaletteOperationChoice[]
  readonly defaultValue: string
  createParams(value: string): Record<string, unknown>
}

export interface NodeCatalogEntry {
  readonly type: NodeTypeId
  readonly category: NodeCategoryId
  readonly labelKey: string
  /** Localized explanatory copy shown by the non-interactive palette
   * tooltip. Required for every ordinary palette entry; definition-owned
   * Call entries provide their dynamic copy in `node-palette.ts`. */
  readonly paletteDescriptionKey?: string
  /** Interface nodes are persistent definition infrastructure, never normal
   * palette choices. */
  readonly palette?: boolean
  /** Families whose concrete operation is selected directly in the palette. */
  readonly paletteOperation?: PaletteOperationConfig
  /** Explicit scope availability for nodes which are intentionally more
   * restricted than the ordinary catalog vocabulary. */
  readonly allowedScopes?: readonly NodeGraphScopeKind[]
  /** Stable input/output port ids, in the order Rete's own port map would report them - used to validate persisted connections without constructing a node. */
  readonly inputs: readonly string[]
  readonly outputs: readonly string[]
  /** Dynamic semantic input identities (currently variadic Boolean child
   * slots) validate against the node's persisted parameter state. */
  isInputPort?(port: string, parameters: Record<string, unknown>): boolean
  /** Semantic socket type for an active persisted port. This is deliberately
   * catalog metadata, not a renderer/CSS inference, so file validation uses
   * the same typing rule as live graph creation. */
  inputSocketType(port: string, parameters: Record<string, unknown>): SocketType | undefined
  outputSocketType(port: string, parameters?: Record<string, unknown>): SocketType | undefined
  /**
   * Creates a node of this type. With no `params`, uses the same
   * defaults palette creation always has. `params`, when given, must
   * already be validated (e.g. via `validateParams`) - used by `.scadlet`
   * project restore (`persistence/restore.ts`) to reconstruct a node
   * with its exact persisted semantic state.
   */
  create(context: NodeCreationContext, params?: Record<string, unknown>): Schemes['Node']
  /** True if `node` was constructed by this entry's `create` - used to identify a live node's catalog type for `.scadlet` serialization. */
  matches(node: Schemes['Node']): boolean
  /** Extracts this node's semantic parameters for `.scadlet` persistence (an empty object for nodes with no parameters, e.g. Difference/Union/Intersection). */
  serializeParams(node: Schemes['Node']): Record<string, unknown>
  /** Validates raw persisted parameters for this node type, throwing a descriptive `Error` on invalid input. */
  validateParams(value: unknown): Record<string, unknown>
}

/**
 * Nodes with no parameters of their own (Difference/Union/Intersection)
 * share this trivial "parameters" validator: persisted parameters must be
 * absent or a plain object, and are otherwise ignored (forward-compatible
 * with any future additive fields, per AGENTS.md's persistence policy).
 */
function validateEmptyParams(value: unknown): Record<string, never> {
  if (value !== undefined && (typeof value !== 'object' || value === null || Array.isArray(value))) {
    throw new Error('Invalid parameters: expected an object (or none) for this node type')
  }
  return {}
}

function validateModuleCallParams(value: unknown): ModuleCallParams {
  if (typeof value !== 'object' || value === null || Array.isArray(value) || typeof (value as Record<string, unknown>).definitionId !== 'string' || !(value as Record<string, unknown>).definitionId) {
    throw new Error('Invalid parameters: expected a non-empty "definitionId"')
  }
  const raw = value as Record<string, unknown>
  if (raw.arguments !== undefined && (typeof raw.arguments !== 'object' || raw.arguments === null || Array.isArray(raw.arguments))) throw new Error('Invalid parameters: "arguments" must be an object')
  return { definitionId: raw.definitionId as string, ...(raw.arguments ? { arguments: raw.arguments as Record<string, ModuleParameterDefault> } : {}) }
}

/** Function Call parameters share Module Call's exact shape; validated
 * separately only so a Function-specific error path stays possible later. */
function validateFunctionCallParams(value: unknown): FunctionCallParams { return validateModuleCallParams(value) }

function validateVariadicBooleanParams(value: unknown): VariadicBooleanParams {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Invalid parameters: expected an object')
  const children = (value as Record<string, unknown>).children
  if (!Array.isArray(children) || children.length === 0) throw new Error('Invalid parameters: "children" must contain at least one slot')
  const seen = new Set<string>()
  return { children: children.map((child, index) => {
    if (typeof child !== 'object' || child === null || Array.isArray(child) || typeof (child as Record<string, unknown>).id !== 'string' || !(child as Record<string, unknown>).id) throw new Error(`Invalid child slot at index ${index}`)
    const id = (child as Record<string, unknown>).id as string
    if (seen.has(id)) throw new Error(`Duplicate child slot id "${id}"`)
    seen.add(id); return { id }
  }) }
}

/**
 * Wraps every one of `node`'s controls' `setValue` method so that any
 * persisted-parameter edit - a numeric field, a checkbox, or a mode
 * select, every current control class (`LabeledNumberControl`/
 * `CheckboxControl`/`SelectControl`) exposes `setValue` - notifies
 * `notifyDirty`, in addition to whatever that control's own `setValue`
 * already does (updating its value, and any node-internal `change`/
 * `onChange` callback such as Cylinder's mode-switching re-render). This
 * is the one place persisted-parameter dirty tracking is wired, rather
 * than touching every node class's constructor or every control's DOM
 * listener in `render.ts` - it fires identically no matter how a
 * control's value ends up changing (a DOM listener today, or any future
 * non-DOM call path), and needs zero DOM to unit test.
 *
 * Deliberately does NOT fire during node construction: initial control
 * values (including a restored node's persisted parameters) are set via
 * each control's constructor `initial` option, never via `setValue()` -
 * so constructing/restoring a node with non-default parameters never
 * spuriously marks the project dirty.
 *
 * Idempotent per control (`wrappedControls`): Cylinder/Sphere replace
 * some of their own controls at runtime (e.g. switching radius/diameter/
 * tapered mode removes and re-adds `r`/`d`/`r1`/`r2`, per their own
 * `updateSizeControls()`); the NODE_CATALOG wrapper below re-runs this
 * function on every `onControlsChanged` call so freshly-added
 * replacement controls get wrapped too, without double-wrapping (and
 * double-firing `notifyDirty` for) controls that already were.
 */
const wrappedControls = new WeakSet<ClassicPreset.Control>()

function wireDirtyNotifications(node: Schemes['Node'], notifyDirty: (() => void) | undefined): void {
  if (!notifyDirty) return

  for (const control of Object.values(node.controls)) {
    if (!control || wrappedControls.has(control)) continue
    if (typeof (control as { setValue?: unknown }).setValue !== 'function') continue

    wrappedControls.add(control)
    const withSetValue = control as unknown as { setValue: (value: unknown) => void }
    const originalSetValue = withSetValue.setValue.bind(control)
    withSetValue.setValue = (value: unknown) => {
      originalSetValue(value)
      notifyDirty()
    }
  }
}

/**
 * Node categories, in palette display order. AGENTS.md explicitly asks
 * for clearer educational names than OpenSCAD's own "CSG" terminology
 * (hence `boolean-operations` / "Boolean operations" rather than "CSG").
 * Only categories with at least one implemented node type belong here -
 * future ids (modifiers, extrusion) are added once their first node type
 * exists, not preemptively.
 */
export const NODE_CATEGORIES: readonly NodeCategory[] = [
  { id: 'primitives', labelKey: 'category.primitives' },
  { id: 'transformations', labelKey: 'category.transformations' },
  { id: 'boolean-operations', labelKey: 'category.booleanOperations' },
  { id: 'control-flow', labelKey: 'category.controlFlow' },
  { id: 'settings', labelKey: 'category.settings' },
  { id: 'values', labelKey: 'category.values' },
  { id: 'math', labelKey: 'category.math' },
]

/** The closed value-expression vocabulary a Function definition graph may
 * contain (AGENTS.md Milestone 8 Phase 7, section 6): Function's own
 * interface nodes plus the existing value/math nodes. Geometry-producing/
 * consuming nodes and any Module/Function Call are deliberately excluded.
 * Shared by `persistence/validate.ts` (file validation) and `editor.ts`
 * (live node-creation/scope-transfer gating) so both enforce identically. */
export const FUNCTION_GRAPH_ALLOWED_NODE_TYPES: ReadonlySet<NodeTypeId> = new Set([
  'function-inputs', 'function-output', 'function-call', 'variable-reference', 'number', 'boolean', 'vector3', 'arithmetic', 'trigonometry', 'basic-math', 'exponential-log', 'compare', 'conditional',
])

/**
 * The single source of truth for "what node types exist and how are they
 * created". The palette UI, the canvas drop handler, and the click
 * fallback all resolve a `NodeTypeId` through this catalog and call
 * `entry.create()` rather than duplicating per-node-type construction
 * logic (see `editor.ts`'s `addNodeAt`). `.scadlet`
 * project persistence (`persistence/`) reuses the same catalog for both
 * directions: `serializeParams`/`matches` to save a live node, and
 * `validateParams`/`create(context, params)` to restore one.
 *
 * Every entry's `create` is wrapped once, uniformly, below
 * (`wireDirtyNotifications`) so persisted-parameter edits mark the
 * project dirty regardless of node type - see that function's doc
 * comment for why this is done here rather than per node class.
 */
const CATALOG_ENTRIES: readonly NodeCatalogEntry[] = [
  {
    type: 'variable-reference', category: 'values', labelKey: 'node.variableReference', palette: false, inputs: [], outputs: ['value'],
    inputSocketType: () => undefined,
    // File validation resolves this dynamic type from the enclosing scope's
    // binding table; it is intentionally not duplicated in persisted params.
    outputSocketType: () => undefined,
    create: (context, params) => {
      const reference = validateVariableReferenceParams(params)
      const binding = context.resolveVariableBinding?.(reference.bindingId)
      if (!binding) throw new Error(`Unknown variable binding "${reference.bindingId}".`)
      return new VariableReferenceNode(reference, binding)
    },
    matches: (node) => node instanceof VariableReferenceNode,
    serializeParams: (node) => (node as VariableReferenceNode).getPersistedParams() as unknown as Record<string, unknown>,
    validateParams: (value) => validateVariableReferenceParams(value) as unknown as Record<string, unknown>,
  },
  {
    type: 'scad-settings', category: 'settings', labelKey: 'palette.scadSettings', paletteDescriptionKey: 'palette.description.scadSettings',
    allowedScopes: ['main', 'module'], inputs: [], outputs: [],
    isInputPort: (port, parameters) => validateScadSettingsParams(parameters)[port as keyof ScadSettingsParams] !== undefined,
    inputSocketType: (port) => ['fn', 'fa', 'fs'].includes(port) ? 'number' : undefined,
    outputSocketType: () => undefined,
    create: (context, params) => {
      let node!: ScadSettingsNode
      node = new ScadSettingsNode(
        params ? validateScadSettingsParams(params) : {},
        () => context.onControlsChanged(node.id),
        (keys, label) => context.requestRemoveForm?.(node.id, keys, label) ?? Promise.resolve(true),
      )
      return node
    },
    matches: (node) => node instanceof ScadSettingsNode,
    serializeParams: (node) => (node as ScadSettingsNode).getPersistedParams() as Record<string, unknown>,
    validateParams: (value) => validateScadSettingsParams(value) as Record<string, unknown>,
  },
  {
    type: 'module-call', category: 'values', labelKey: 'node.moduleCall', palette: false, inputs: [], outputs: ['geometry'],
    inputSocketType: (port) => port.startsWith('geometry:') ? 'geometry' : undefined, outputSocketType: (port) => port === 'geometry' ? 'geometry' : undefined,
    create: (context, params) => {
      const call = validateModuleCallParams(params)
      const definition = context.getModuleDefinition?.(call.definitionId)
      if (!definition) throw new Error(`Unknown Module definition "${call.definitionId}".`)
      return new ModuleCallNode(definition, call, (id) => context.onControlsChanged(id))
    },
    matches: (node) => node instanceof ModuleCallNode,
    serializeParams: (node) => (node as ModuleCallNode).getPersistedParams() as unknown as Record<string, unknown>,
    validateParams: (value) => validateModuleCallParams(value) as unknown as Record<string, unknown>,
  },
  {
    type: 'module-inputs', category: 'values', labelKey: 'node.moduleInputs', palette: false, inputs: [], outputs: [],
    inputSocketType: () => undefined, outputSocketType: (port) => port.startsWith('geometry:') ? 'geometry' : undefined,
    create: () => new ModuleInputsNode(),
    matches: (node) => node instanceof ModuleInputsNode,
    serializeParams: validateEmptyParams,
    validateParams: validateEmptyParams,
  },
  {
    type: 'module-output', category: 'values', labelKey: 'node.moduleOutput', palette: false, inputs: ['geometry'], outputs: [],
    inputSocketType: (port) => port === 'geometry' ? 'geometry' : undefined,
    outputSocketType: () => undefined,
    create: () => new ModuleOutputNode(),
    matches: (node) => node instanceof ModuleOutputNode,
    serializeParams: validateEmptyParams,
    validateParams: validateEmptyParams,
  },
  {
    type: 'function-call', category: 'values', labelKey: 'node.functionCall', palette: false, inputs: [], outputs: ['value'],
    inputSocketType: () => undefined, outputSocketType: () => undefined,
    create: (context, params) => {
      const call = validateFunctionCallParams(params)
      const definition = context.getModuleDefinition?.(call.definitionId)
      if (!definition || definition.kind !== 'function') throw new Error(`Unknown Function definition "${call.definitionId}".`)
      return new FunctionCallNode(definition, call, (id) => context.onControlsChanged(id))
    },
    matches: (node) => node instanceof FunctionCallNode,
    serializeParams: (node) => (node as FunctionCallNode).getPersistedParams() as unknown as Record<string, unknown>,
    validateParams: (value) => validateFunctionCallParams(value) as unknown as Record<string, unknown>,
  },
  {
    type: 'function-inputs', category: 'values', labelKey: 'node.functionInputs', palette: false, inputs: [], outputs: [],
    inputSocketType: () => undefined, outputSocketType: () => undefined,
    create: () => new FunctionInputsNode(),
    matches: (node) => node instanceof FunctionInputsNode,
    serializeParams: validateEmptyParams,
    validateParams: validateEmptyParams,
  },
  {
    type: 'function-output', category: 'values', labelKey: 'node.functionOutput', palette: false, inputs: ['result'], outputs: [],
    inputSocketType: () => undefined,
    outputSocketType: () => undefined,
    create: () => new FunctionOutputNode(),
    matches: (node) => node instanceof FunctionOutputNode,
    serializeParams: validateEmptyParams,
    validateParams: validateEmptyParams,
  },
  {
    type: 'number', category: 'values', labelKey: 'node.number', paletteDescriptionKey: 'palette.description.number', inputs: [], outputs: ['value'],
    inputSocketType: () => undefined, outputSocketType: (port) => port === 'value' ? 'number' : undefined,
    create: (_context, params) => new NumberNode(params ? validateNumberParams(params) : undefined),
    matches: (node) => node instanceof NumberNode,
    serializeParams: (node) => (node as NumberNode).getPersistedParams() as unknown as Record<string, unknown>,
    validateParams: (value) => validateNumberParams(value) as unknown as Record<string, unknown>,
  },
  {
    type: 'boolean', category: 'values', labelKey: 'node.boolean', paletteDescriptionKey: 'palette.description.boolean', inputs: [], outputs: ['value'],
    inputSocketType: () => undefined, outputSocketType: (port) => port === 'value' ? 'boolean' : undefined,
    create: (_context, params) => new BooleanNode(params ? validateBooleanParams(params) : undefined),
    matches: (node) => node instanceof BooleanNode,
    serializeParams: (node) => (node as BooleanNode).getPersistedParams() as unknown as Record<string, unknown>,
    validateParams: (value) => validateBooleanParams(value) as unknown as Record<string, unknown>,
  },
  {
    type: 'vector3', category: 'values', labelKey: 'node.vector3', paletteDescriptionKey: 'palette.description.vector3', inputs: ['x', 'y', 'z'], outputs: ['value'],
    inputSocketType: (port) => ['x', 'y', 'z'].includes(port) ? 'number' : undefined,
    outputSocketType: (port) => port === 'value' ? 'vector3' : undefined,
    create: (_context, params) => new Vector3Node(params ? validateVector3ValueParams(params) : undefined),
    matches: (node) => node instanceof Vector3Node,
    serializeParams: (node) => (node as Vector3Node).getPersistedParams() as unknown as Record<string, unknown>,
    validateParams: (value) => validateVector3ValueParams(value) as unknown as Record<string, unknown>,
  },
  {
    type: 'arithmetic', category: 'math', labelKey: 'node.arithmetic', paletteDescriptionKey: 'palette.description.arithmetic', inputs: ['a', 'b'], outputs: ['value'],
    paletteOperation: {
      accessibleLabelKey: 'node.arithmeticOperation', defaultValue: 'addition',
      options: [{ value: 'addition', label: '+' }, { value: 'subtraction', label: '−' }, { value: 'multiplication', label: '×' }, { value: 'division', label: '÷' }, { value: 'modulo', label: '%' }, { value: 'power', label: 'pow' }],
      createParams: (operation) => validateArithmeticParams({ operation, a: 0, b: 0 }) as unknown as Record<string, unknown>,
    },
    inputSocketType: (port) => ['a', 'b'].includes(port) ? 'number' : undefined,
    outputSocketType: (port) => port === 'value' ? 'number' : undefined,
    create: (_context, params) => new ArithmeticNode(params ? validateArithmeticParams(params) : undefined),
    matches: (node) => node instanceof ArithmeticNode,
    serializeParams: (node) => (node as ArithmeticNode).getPersistedParams() as unknown as Record<string, unknown>,
    validateParams: (value) => validateArithmeticParams(value) as unknown as Record<string, unknown>,
  },
  {
    type: 'trigonometry', category: 'math', labelKey: 'node.trigonometry', paletteDescriptionKey: 'palette.description.trigonometry', inputs: ['a'], outputs: ['value'],
    paletteOperation: {
      accessibleLabelKey: 'node.trigonometryOperation', defaultValue: 'sin',
      options: ['sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'atan2'].map((value) => ({ value, label: value })),
      createParams: (operation) => validateTrigonometryParams({ operation, a: 0, b: 0, inputPorts: operation === 'atan2' ? ['a', 'b'] : ['a'] }) as unknown as Record<string, unknown>,
    },
    isInputPort: (port, parameters) => validateTrigonometryParams(parameters).inputPorts.includes(port as 'a' | 'b'),
    inputSocketType: (port, parameters) => validateTrigonometryParams(parameters).inputPorts.includes(port as 'a' | 'b') ? 'number' : undefined,
    outputSocketType: (port) => port === 'value' ? 'number' : undefined,
    create: (context, params) => {
      const node = new TrigonometryNode(params ? validateTrigonometryParams(params) : undefined)
      const control = node.controls.operation as import('./controls').TitleSelectControl<TrigonometryOperation>
      if (context.requestTrigonometryOperationChange) control.onRequestChange = (operation) => context.requestTrigonometryOperationChange!(node.id, operation)
      else control.onRequestChange = (operation) => { node.setOperation(operation); return true }
      return node
    },
    matches: (node) => node instanceof TrigonometryNode,
    serializeParams: (node) => (node as TrigonometryNode).getPersistedParams() as unknown as Record<string, unknown>,
    validateParams: (value) => validateTrigonometryParams(value) as unknown as Record<string, unknown>,
  },
  {
    type: 'basic-math', category: 'math', labelKey: 'node.basicMath', paletteDescriptionKey: 'palette.description.basicMath', inputs: ['x'], outputs: ['value'],
    paletteOperation: {
      accessibleLabelKey: 'node.basicMathOperation', defaultValue: 'abs',
      options: ['abs', 'sign', 'sqrt', 'floor', 'ceil', 'round'].map((value) => ({ value, label: value })),
      createParams: (operation) => validateBasicMathParams({ operation, x: 0 }) as unknown as Record<string, unknown>,
    },
    inputSocketType: (port) => port === 'x' ? 'number' : undefined,
    outputSocketType: (port) => port === 'value' ? 'number' : undefined,
    create: (_context, params) => new BasicMathNode(params ? validateBasicMathParams(params) : undefined),
    matches: (node) => node instanceof BasicMathNode,
    serializeParams: (node) => (node as BasicMathNode).getPersistedParams() as unknown as Record<string, unknown>,
    validateParams: (value) => validateBasicMathParams(value) as unknown as Record<string, unknown>,
  },
  {
    type: 'exponential-log', category: 'math', labelKey: 'node.exponentialLog', paletteDescriptionKey: 'palette.description.exponentialLog', inputs: ['x'], outputs: ['value'],
    paletteOperation: {
      accessibleLabelKey: 'node.exponentialLogOperation', defaultValue: 'exp',
      options: ['exp', 'ln', 'log'].map((value) => ({ value, label: value })),
      createParams: (operation) => validateExponentialLogParams({ operation, x: 0 }) as unknown as Record<string, unknown>,
    },
    inputSocketType: (port) => port === 'x' ? 'number' : undefined,
    outputSocketType: (port) => port === 'value' ? 'number' : undefined,
    create: (_context, params) => new ExponentialLogNode(params ? validateExponentialLogParams(params) : undefined),
    matches: (node) => node instanceof ExponentialLogNode,
    serializeParams: (node) => (node as ExponentialLogNode).getPersistedParams() as unknown as Record<string, unknown>,
    validateParams: (value) => validateExponentialLogParams(value) as unknown as Record<string, unknown>,
  },
  {
    type: 'compare', category: 'math', labelKey: 'node.compare', paletteDescriptionKey: 'palette.description.compare', inputs: ['a', 'b'], outputs: ['value'],
    paletteOperation: {
      accessibleLabelKey: 'node.compareOperator', defaultValue: '<',
      options: ['<', '<=', '>', '>=', '==', '!='].map((value) => ({ value, label: value })),
      createParams: (operator) => validateCompareParams({ operator }) as unknown as Record<string, unknown>,
    },
    inputSocketType: (port) => ['a', 'b'].includes(port) ? 'number' : undefined,
    outputSocketType: (port) => port === 'value' ? 'boolean' : undefined,
    create: (_context, params) => new CompareNode(params ? validateCompareParams(params) : undefined),
    matches: (node) => node instanceof CompareNode,
    serializeParams: (node) => (node as CompareNode).getPersistedParams() as unknown as Record<string, unknown>,
    validateParams: (value) => validateCompareParams(value) as unknown as Record<string, unknown>,
  },
  {
    type: 'conditional', category: 'math', labelKey: 'node.conditional', paletteDescriptionKey: 'palette.description.conditional', inputs: ['condition', 'true', 'false'], outputs: ['result'],
    inputSocketType: (port, parameters) => port === 'condition' ? 'boolean'
      : (port === 'true' || port === 'false') ? validateConditionalParams(parameters).valueType : undefined,
    outputSocketType: (port, parameters?: Record<string, unknown>) => port === 'result' ? (parameters ? validateConditionalParams(parameters).valueType : undefined) : undefined,
    create: (_context, params) => new ConditionalNode(params ? validateConditionalParams(params) : undefined),
    matches: (node) => node instanceof ConditionalNode,
    serializeParams: (node) => (node as ConditionalNode).getPersistedParams() as unknown as Record<string, unknown>,
    validateParams: (value) => validateConditionalParams(value) as unknown as Record<string, unknown>,
  },
  {
    type: 'if', category: 'control-flow', labelKey: 'node.if', paletteDescriptionKey: 'palette.description.if', inputs: ['condition', 'then', 'else'], outputs: ['geometry'],
    inputSocketType: (port) => port === 'condition' ? 'boolean' : (port === 'then' || port === 'else') ? 'geometry' : undefined,
    outputSocketType: (port) => port === 'geometry' ? 'geometry' : undefined,
    create: () => new IfNode(),
    matches: (node) => node instanceof IfNode,
    serializeParams: validateEmptyParams,
    validateParams: validateEmptyParams,
  },
  {
    type: 'cube',
    category: 'primitives',
    labelKey: 'node.cube',
    paletteDescriptionKey: 'palette.description.cube',
    inputs: [],
    outputs: ['geometry'],
    isInputPort: (port, parameters) => {
      const params = parameters as unknown as CubeParams
      if (port === 'center') return params.center !== undefined
      if (params.sizeRepresentation === 'scalar') return port === 'size'
      if (params.sizeRepresentation === 'xyz') return ['sizeX', 'sizeY', 'sizeZ'].includes(port)
      return params.sizeRepresentation === 'vector' && port === 'sizeVector'
    },
    inputSocketType: (port) => port === 'center' ? 'boolean' : port === 'sizeVector' ? 'vector3' : ['size', 'sizeX', 'sizeY', 'sizeZ'].includes(port) ? 'number' : undefined,
    outputSocketType: (port) => port === 'geometry' ? 'geometry' : undefined,
    create: (context, params) => {
      let node!: CubeNode
      node = new CubeNode(
        params ? validateCubeParams(params) : undefined,
        () => context.onControlsChanged(node.id),
        (keys, label) => context.requestRemoveForm?.(node.id, keys, label) ?? Promise.resolve(true),
      )
      return node
    },
    matches: (node) => node instanceof CubeNode,
    serializeParams: (node) => (node as CubeNode).getPersistedParams() as unknown as Record<string, unknown>,
    validateParams: (value) => validateCubeParams(value) as unknown as Record<string, unknown>,
  },
  {
    type: 'cylinder',
    category: 'primitives',
    labelKey: 'node.cylinder',
    paletteDescriptionKey: 'palette.description.cylinder',
    inputs: [],
    outputs: ['geometry'],
    isInputPort: (port, parameters) => {
      const params = parameters as unknown as CylinderParams
      if (port === 'h') return params.h !== undefined
      if (port === 'center') return params.center !== undefined
      if (port === 'fn') return params.fn !== undefined
      if (params.mode === 'radius') return port === 'r' && params.r !== undefined
      if (params.mode === 'diameter') return port === 'd' && params.d !== undefined
      return params.mode === 'tapered' && ((port === 'r1' && params.r1 !== undefined) || (port === 'r2' && params.r2 !== undefined))
    },
    inputSocketType: (port) => port === 'center' ? 'boolean' : ['h', 'r', 'd', 'r1', 'r2', 'fn'].includes(port) ? 'number' : undefined,
    outputSocketType: (port) => port === 'geometry' ? 'geometry' : undefined,
    create: (context, params) => {
      let node!: CylinderNode
      node = new CylinderNode(
        params ? validateCylinderParams(params) : {},
        () => context.onControlsChanged(node.id),
        (keys, label) => context.requestRemoveForm?.(node.id, keys, label) ?? Promise.resolve(true),
      )
      return node
    },
    matches: (node) => node instanceof CylinderNode,
    serializeParams: (node) => (node as CylinderNode).getPersistedParams() as unknown as Record<string, unknown>,
    validateParams: (value) => validateCylinderParams(value) as unknown as Record<string, unknown>,
  },
  {
    type: 'sphere',
    category: 'primitives',
    labelKey: 'node.sphere',
    paletteDescriptionKey: 'palette.description.sphere',
    inputs: [],
    outputs: ['geometry'],
    isInputPort: (port, parameters) => {
      const params = parameters as unknown as SphereParams
      if (port === 'fn') return params.fn !== undefined
      return (params.mode === 'radius' && port === 'r' && params.r !== undefined)
        || (params.mode === 'diameter' && port === 'd' && params.d !== undefined)
    },
    inputSocketType: (port) => ['r', 'd', 'fn'].includes(port) ? 'number' : undefined,
    outputSocketType: (port) => port === 'geometry' ? 'geometry' : undefined,
    create: (context, params) => {
      let node!: SphereNode
      node = new SphereNode(
        params ? validateSphereParams(params) : {},
        () => context.onControlsChanged(node.id),
        (keys, label) => context.requestRemoveForm?.(node.id, keys, label) ?? Promise.resolve(true),
      )
      return node
    },
    matches: (node) => node instanceof SphereNode,
    serializeParams: (node) => (node as SphereNode).getPersistedParams() as unknown as Record<string, unknown>,
    validateParams: (value) => validateSphereParams(value) as unknown as Record<string, unknown>,
  },
  {
    type: 'translate',
    category: 'transformations',
    labelKey: 'node.translate',
    paletteDescriptionKey: 'palette.description.translate',
    inputs: ['geometry'],
    outputs: ['geometry'],
    isInputPort: (port, parameters) => {
      const params = parameters as unknown as Vector3Params
      return (params.representation === 'vector' && port === 'vector')
        || ((params.representation ?? 'xyz') === 'xyz' && ['x', 'y', 'z'].includes(port))
    },
    inputSocketType: (port) => port === 'geometry' ? 'geometry' : port === 'vector' ? 'vector3' : ['x', 'y', 'z'].includes(port) ? 'number' : undefined,
    outputSocketType: (port) => port === 'geometry' ? 'geometry' : undefined,
    create: (context, params) => {
      let node!: TranslateNode
      node = new TranslateNode(
        params ? validateVector3Params(params, 'Translate') : undefined,
        () => context.onControlsChanged(node.id),
        (keys, label) => context.requestRemoveForm?.(node.id, keys, label) ?? Promise.resolve(true),
      )
      return node
    },
    matches: (node) => node instanceof TranslateNode,
    serializeParams: (node) => (node as TranslateNode).getPersistedParams() as unknown as Record<string, unknown>,
    validateParams: (value) => validateVector3Params(value, 'Translate') as unknown as Record<string, unknown>,
  },
  {
    type: 'rotate',
    category: 'transformations',
    labelKey: 'node.rotate',
    paletteDescriptionKey: 'palette.description.rotate',
    inputs: ['geometry'],
    outputs: ['geometry'],
    isInputPort: (port, parameters) => {
      const params = parameters as unknown as Vector3Params
      return (params.representation === 'vector' && port === 'vector')
        || ((params.representation ?? 'xyz') === 'xyz' && ['x', 'y', 'z'].includes(port))
    },
    inputSocketType: (port) => port === 'geometry' ? 'geometry' : port === 'vector' ? 'vector3' : ['x', 'y', 'z'].includes(port) ? 'number' : undefined,
    outputSocketType: (port) => port === 'geometry' ? 'geometry' : undefined,
    create: (context, params) => {
      let node!: RotateNode
      node = new RotateNode(
        params ? validateVector3Params(params, 'Rotate') : undefined,
        () => context.onControlsChanged(node.id),
        (keys, label) => context.requestRemoveForm?.(node.id, keys, label) ?? Promise.resolve(true),
      )
      return node
    },
    matches: (node) => node instanceof RotateNode,
    serializeParams: (node) => (node as RotateNode).getPersistedParams() as unknown as Record<string, unknown>,
    validateParams: (value) => validateVector3Params(value, 'Rotate') as unknown as Record<string, unknown>,
  },
  {
    type: 'scale',
    category: 'transformations',
    labelKey: 'node.scale',
    paletteDescriptionKey: 'palette.description.scale',
    inputs: ['geometry'],
    outputs: ['geometry'],
    isInputPort: (port, parameters) => {
      const params = parameters as unknown as Vector3Params
      return (params.representation === 'vector' && port === 'vector')
        || ((params.representation ?? 'xyz') === 'xyz' && ['x', 'y', 'z'].includes(port))
    },
    inputSocketType: (port) => port === 'geometry' ? 'geometry' : port === 'vector' ? 'vector3' : ['x', 'y', 'z'].includes(port) ? 'number' : undefined,
    outputSocketType: (port) => port === 'geometry' ? 'geometry' : undefined,
    create: (context, params) => {
      let node!: ScaleNode
      node = new ScaleNode(
        params ? validateVector3Params(params, 'Scale') : undefined,
        () => context.onControlsChanged(node.id),
        (keys, label) => context.requestRemoveForm?.(node.id, keys, label) ?? Promise.resolve(true),
      )
      return node
    },
    matches: (node) => node instanceof ScaleNode,
    serializeParams: (node) => (node as ScaleNode).getPersistedParams() as unknown as Record<string, unknown>,
    validateParams: (value) => validateVector3Params(value, 'Scale') as unknown as Record<string, unknown>,
  },
  {
    type: 'difference',
    category: 'boolean-operations',
    labelKey: 'node.difference',
    paletteDescriptionKey: 'palette.description.difference',
    inputs: ['base', 'subtract'],
    outputs: ['geometry'],
    inputSocketType: () => 'geometry',
    outputSocketType: (port) => port === 'geometry' ? 'geometry' : undefined,
    create: () => new DifferenceNode(),
    matches: (node) => node instanceof DifferenceNode,
    serializeParams: validateEmptyParams,
    validateParams: validateEmptyParams,
  },
  {
    type: 'union',
    category: 'boolean-operations',
    labelKey: 'node.union',
    paletteDescriptionKey: 'palette.description.union',
    inputs: [],
    outputs: ['geometry'],
    inputSocketType: (port, params) => (params as unknown as VariadicBooleanParams).children.some((child) => port === `child:${child.id}` || port === child.id) ? 'geometry' : undefined,
    outputSocketType: (port) => port === 'geometry' ? 'geometry' : undefined,
    create: (_context, params) => new UnionNode(params ? validateVariadicBooleanParams(params) : {}, false),
    matches: (node) => node instanceof UnionNode,
    serializeParams: (node) => (node as UnionNode).getPersistedParams() as unknown as Record<string, unknown>,
    validateParams: (value) => validateVariadicBooleanParams(value) as unknown as Record<string, unknown>,
    isInputPort: (port, params) => (params as unknown as VariadicBooleanParams).children.some((child) => port === `child:${child.id}` || port === child.id),
  },
  {
    type: 'intersection',
    category: 'boolean-operations',
    labelKey: 'node.intersection',
    paletteDescriptionKey: 'palette.description.intersection',
    inputs: [],
    outputs: ['geometry'],
    inputSocketType: (port, params) => (params as unknown as VariadicBooleanParams).children.some((child) => port === `child:${child.id}` || port === child.id) ? 'geometry' : undefined,
    outputSocketType: (port) => port === 'geometry' ? 'geometry' : undefined,
    create: (_context, params) => new IntersectionNode(params ? validateVariadicBooleanParams(params) : {}, false),
    matches: (node) => node instanceof IntersectionNode,
    serializeParams: (node) => (node as IntersectionNode).getPersistedParams() as unknown as Record<string, unknown>,
    validateParams: (value) => validateVariadicBooleanParams(value) as unknown as Record<string, unknown>,
    isInputPort: (port, params) => (params as unknown as VariadicBooleanParams).children.some((child) => port === `child:${child.id}` || port === child.id),
  },
]

/**
 * The public catalog: identical to `CATALOG_ENTRIES` except `create`
 * also wires dirty notifications (see `wireDirtyNotifications`) - both
 * right after construction and again every time `onControlsChanged`
 * fires, since that's exactly when Cylinder/Sphere replace some of their
 * own controls (mode/`$fn` switches) with fresh, as-yet-unwrapped ones.
 */
export const NODE_CATALOG: readonly NodeCatalogEntry[] = CATALOG_ENTRIES.map((entry) => ({
  ...entry,
  create: (context: NodeCreationContext, params?: Record<string, unknown>) => {
    let node!: Schemes['Node']
    const wrappedContext: NodeCreationContext = {
      onControlsChanged: (nodeId) => {
        wireDirtyNotifications(node, context.notifyDirty)
        context.onControlsChanged(nodeId)
      },
      notifyDirty: context.notifyDirty,
      canRemoveInputs: context.canRemoveInputs,
      requestRemoveForm: context.requestRemoveForm,
      getModuleDefinition: context.getModuleDefinition,
      requestTrigonometryOperationChange: context.requestTrigonometryOperationChange,
      resolveVariableBinding: context.resolveVariableBinding,
    }
    node = entry.create(wrappedContext, params)
    wireDirtyNotifications(node, context.notifyDirty)
    return node
  },
}))

/** Looks up a catalog entry by its (possibly untrusted, e.g. drag-payload) type string. */
export function findCatalogEntry(type: string): NodeCatalogEntry | undefined {
  return NODE_CATALOG.find((entry) => entry.type === type)
}

/** Identifies a live node's catalog type id, or `undefined` if it wasn't constructed by any current catalog entry. */
export function identifyNodeType(node: Schemes['Node']): NodeTypeId | undefined {
  return NODE_CATALOG.find((entry) => entry.matches(node))?.type
}

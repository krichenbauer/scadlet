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
import { BooleanNode, MathNode, NumberNode, Vector3Node, validateBooleanParams, validateMathParams, validateNumberParams, validateVector3ValueParams } from './nodes/value-nodes'
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
import { t } from '../i18n/translate'

/** MIME type used to carry a node-catalog `type` id through native HTML drag-and-drop (see `node-palette.ts`/`node-editor.ts`). */
export const NODE_DRAG_MIME_TYPE = 'application/x-scadlet-node-type'

/**
 * Stable, language-independent category ids. Display text lives in
 * `src/i18n/translate.ts`, looked up via each category's `labelKey` -
 * never derive UI copy from these ids directly.
 */
export type NodeCategoryId = 'primitives' | 'transformations' | 'boolean-operations' | 'values' | 'math'

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
  | 'add'
  | 'subtract'
  | 'multiply'
  | 'divide'

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
  canSwitchRepresentation?(nodeId: string): boolean
}

export interface NodeCatalogEntry {
  readonly type: NodeTypeId
  readonly category: NodeCategoryId
  readonly labelKey: string
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
  outputSocketType(port: string): SocketType | undefined
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
  { id: 'values', labelKey: 'category.values' },
  { id: 'math', labelKey: 'category.math' },
]

/**
 * The single source of truth for "what node types exist and how are they
 * created". The palette UI, the canvas drop handler, and the click
 * fallback all resolve a `NodeTypeId` through this catalog and call
 * `entry.create()` rather than duplicating per-node-type construction
 * logic (see `editor.ts`'s `addNodeAt`/`addNodeAtCenter`). `.scadlet`
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
    type: 'number', category: 'values', labelKey: 'node.number', inputs: [], outputs: ['value'],
    inputSocketType: () => undefined, outputSocketType: (port) => port === 'value' ? 'number' : undefined,
    create: (_context, params) => new NumberNode(params ? validateNumberParams(params) : undefined),
    matches: (node) => node instanceof NumberNode,
    serializeParams: (node) => (node as NumberNode).getPersistedParams() as unknown as Record<string, unknown>,
    validateParams: (value) => validateNumberParams(value) as unknown as Record<string, unknown>,
  },
  {
    type: 'boolean', category: 'values', labelKey: 'node.boolean', inputs: [], outputs: ['value'],
    inputSocketType: () => undefined, outputSocketType: (port) => port === 'value' ? 'boolean' : undefined,
    create: (_context, params) => new BooleanNode(params ? validateBooleanParams(params) : undefined),
    matches: (node) => node instanceof BooleanNode,
    serializeParams: (node) => (node as BooleanNode).getPersistedParams() as unknown as Record<string, unknown>,
    validateParams: (value) => validateBooleanParams(value) as unknown as Record<string, unknown>,
  },
  {
    type: 'vector3', category: 'values', labelKey: 'node.vector3', inputs: ['x', 'y', 'z'], outputs: ['value'],
    inputSocketType: (port) => ['x', 'y', 'z'].includes(port) ? 'number' : undefined,
    outputSocketType: (port) => port === 'value' ? 'vector3' : undefined,
    create: (_context, params) => new Vector3Node(params ? validateVector3ValueParams(params) : undefined),
    matches: (node) => node instanceof Vector3Node,
    serializeParams: (node) => (node as Vector3Node).getPersistedParams() as unknown as Record<string, unknown>,
    validateParams: (value) => validateVector3ValueParams(value) as unknown as Record<string, unknown>,
  },
  ...([
    ['add', 'node.add', '+'],
    ['subtract', 'node.subtract', '-'],
    ['multiply', 'node.multiply', '*'],
    ['divide', 'node.divide', '/'],
  ] as const).map(([type, labelKey, operator]): NodeCatalogEntry => ({
    type, category: 'math', labelKey, inputs: ['a', 'b'], outputs: ['value'],
    inputSocketType: (port) => ['a', 'b'].includes(port) ? 'number' : undefined,
    outputSocketType: (port) => port === 'value' ? 'number' : undefined,
    create: (_context, params) => new MathNode(t(labelKey), operator, type, params ? validateMathParams(params) : undefined),
    matches: (node) => node instanceof MathNode && node.type === type,
    serializeParams: (node) => (node as MathNode).getPersistedParams() as unknown as Record<string, unknown>,
    validateParams: (value) => validateMathParams(value) as unknown as Record<string, unknown>,
  })),
  {
    type: 'cube',
    category: 'primitives',
    labelKey: 'node.cube',
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
        () => context.canSwitchRepresentation?.(node.id) ?? true,
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
      const node = new CylinderNode(
        params ? validateCylinderParams(params) : {},
        () => context.onControlsChanged(node.id),
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
      const node = new SphereNode(
        params ? validateSphereParams(params) : {},
        () => context.onControlsChanged(node.id),
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
        () => context.canSwitchRepresentation?.(node.id) ?? true,
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
        () => context.canSwitchRepresentation?.(node.id) ?? true,
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
        () => context.canSwitchRepresentation?.(node.id) ?? true,
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
      canSwitchRepresentation: context.canSwitchRepresentation,
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

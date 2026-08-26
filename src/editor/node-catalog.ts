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

/** MIME type used to carry a node-catalog `type` id through native HTML drag-and-drop (see `node-palette.ts`/`node-editor.ts`). */
export const NODE_DRAG_MIME_TYPE = 'application/x-scadlet-node-type'

/**
 * Stable, language-independent category ids. Display text lives in
 * `src/i18n/translate.ts`, looked up via each category's `labelKey` -
 * never derive UI copy from these ids directly.
 */
export type NodeCategoryId = 'primitives' | 'transformations' | 'boolean-operations'

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

export interface NodeCategory {
  readonly id: NodeCategoryId
  readonly labelKey: string
}

export interface NodeCreationContext {
  /** Re-renders a node after its dynamic control set changes (e.g. Cylinder's size mode) - see `editor.ts`. */
  onControlsChanged(nodeId: string): void
}

export interface NodeCatalogEntry {
  readonly type: NodeTypeId
  readonly category: NodeCategoryId
  readonly labelKey: string
  create(context: NodeCreationContext): Schemes['Node']
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
]

/**
 * The single source of truth for "what node types exist and how are they
 * created". The palette UI, the canvas drop handler, and the click
 * fallback all resolve a `NodeTypeId` through this catalog and call
 * `entry.create()` rather than duplicating per-node-type construction
 * logic (see `editor.ts`'s `addNodeAt`/`addNodeAtCenter`).
 */
export const NODE_CATALOG: readonly NodeCatalogEntry[] = [
  {
    type: 'cube',
    category: 'primitives',
    labelKey: 'node.cube',
    create: () => new CubeNode(),
  },
  {
    type: 'cylinder',
    category: 'primitives',
    labelKey: 'node.cylinder',
    create: (context) => {
      const node = new CylinderNode({}, () => context.onControlsChanged(node.id))
      return node
    },
  },
  {
    type: 'sphere',
    category: 'primitives',
    labelKey: 'node.sphere',
    create: (context) => {
      const node = new SphereNode({}, () => context.onControlsChanged(node.id))
      return node
    },
  },
  {
    type: 'translate',
    category: 'transformations',
    labelKey: 'node.translate',
    create: () => new TranslateNode(),
  },
  {
    type: 'rotate',
    category: 'transformations',
    labelKey: 'node.rotate',
    create: () => new RotateNode(),
  },
  {
    type: 'scale',
    category: 'transformations',
    labelKey: 'node.scale',
    create: () => new ScaleNode(),
  },
  {
    type: 'difference',
    category: 'boolean-operations',
    labelKey: 'node.difference',
    create: () => new DifferenceNode(),
  },
  {
    type: 'union',
    category: 'boolean-operations',
    labelKey: 'node.union',
    create: () => new UnionNode(),
  },
  {
    type: 'intersection',
    category: 'boolean-operations',
    labelKey: 'node.intersection',
    create: () => new IntersectionNode(),
  },
]

/** Looks up a catalog entry by its (possibly untrusted, e.g. drag-payload) type string. */
export function findCatalogEntry(type: string): NodeCatalogEntry | undefined {
  return NODE_CATALOG.find((entry) => entry.type === type)
}

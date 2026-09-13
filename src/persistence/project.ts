import type { Position } from '../editor/coordinates'
import type { FunctionResultType, ModuleGeometryInput, ModuleParameter } from '../editor/definitions'

/** SCADlet's own project-file format identifier (see `parseScadletProject` in `validate.ts`). */
export const SCADLET_FORMAT = 'scadlet' as const

/** Current `.scadlet` schema version this build writes and fully supports reading. */
export const SCADLET_VERSION = 6 as const

export interface ScadletProjectMetadata {
  /** Required before the first explicit Save/Save As/export - see `filename.ts`. */
  name: string
  createdAt?: string
  updatedAt?: string
}

/**
 * A single persisted node. `position` is presentation/layout state (the
 * node's top-left graph coordinate - AGENTS.md persistence notes), not
 * OpenSCAD semantics; `parameters` is this node type's full semantic
 * state (including any progressive-disclosure state that changes
 * generated OpenSCAD, e.g. a Sphere's size mode or `$fn`), validated
 * against the node's own catalog entry (`editor/node-catalog.ts`).
 * `collapsed` is explicit user presentation state. Its omission is the
 * v6-compatible expanded default, so old records restore normally open.
 */
export interface ScadletNodeDTO {
  id: string
  /** Stable catalog `NodeTypeId` (see `editor/node-catalog.ts`) - never a translated label or constructor name. */
  type: string
  position: Position
  parameters: Record<string, unknown>
  collapsed?: boolean
}

/**
 * A single persisted connection, addressing concrete ports (AGENTS.md
 * persistence notes) rather than merely a node-to-node pair - required
 * for nodes with more than one input (e.g. Difference's `base`/
 * `subtract`) and future value/parameter sockets. `id` is Rete's own
 * connection id, persisted as an opaque stable identifier: connection
 * identity carries no semantic meaning of its own (topology is fully
 * defined by the four endpoint fields), but persisting it keeps restore
 * fully deterministic without needing a separate regeneration policy.
 */
export interface ScadletConnectionDTO {
  id: string
  source: string
  sourceOutput: string
  target: string
  targetInput: string
}

export interface ScadletGraph {
  nodes: ScadletNodeDTO[]
  connections: ScadletConnectionDTO[]
}

/** A named project-level graph scope. Module IDs and interface node IDs are
 * stable identities; their visible names are intentionally separate. */
export interface ScadletModuleDefinition {
  id: string
  kind: 'module'
  name: string
  interface: {
    inputs: string
    output: string
  }
  /** Ordered Module signature. Version 3 remains backward-compatible: old
   * parameterless records normalize a missing array to `[]`. */
  parameters: ModuleParameter[]
  /** Ordered child-block interface; structurally separate from value parameters. */
  geometryInputs: ModuleGeometryInput[]
  graph: ScadletGraph
}

/** A named project-level Function scope (version 5). Shares the exact same
 * stable-id parameter-signature shape as a Module, but has no
 * `geometryInputs` and instead an optional `resultType` - absent while the
 * Function is still an unresolved, uncallable draft (see AGENTS.md's
 * Function Output/result-type inference requirements). */
export interface ScadletFunctionDefinition {
  id: string
  kind: 'function'
  name: string
  interface: {
    inputs: string
    output: string
  }
  parameters: ModuleParameter[]
  resultType?: FunctionResultType
  graph: ScadletGraph
}

export type ScadletDefinition = ScadletModuleDefinition | ScadletFunctionDefinition

/** The node-editor's infinite-canvas pan/zoom state - editor presentation, not OpenSCAD semantics. */
export interface ScadletViewport {
  x: number
  y: number
  zoom: number
}

export interface ScadletEditorState {
  viewport: ScadletViewport
}

/** Enough Three.js view state to restore the user's camera - see `components/geometry-viewer.ts`. Z-up, matching the viewer's OpenSCAD-consistent convention. */
export interface ScadletViewerCamera {
  position: [number, number, number]
  target: [number, number, number]
}

export interface ScadletViewerState {
  camera: ScadletViewerCamera
}

/**
 * SCADlet's own versioned project schema (Milestone 5, extended by
 * Milestone 8 Function definitions). Deliberately independent of
 * Rete/DOM/Three.js internals - see AGENTS.md's "Canonical `.scadlet`
 * project format" section. Inspect Node state and transient editor state
 * (selection, marquee, hover timers, drag state, node foreground order)
 * are intentionally never part of this shape.
 */
export interface ScadletProjectV6 {
  format: typeof SCADLET_FORMAT
  version: typeof SCADLET_VERSION
  metadata: ScadletProjectMetadata
  graph: ScadletGraph
  definitions: ScadletDefinition[]
  editor: ScadletEditorState
  viewer: ScadletViewerState
}

/** Current canonical project type. The old exported name remains an alias
 * for application adapters while v1 remains an input-only migration shape. */
export type ScadletProjectV1 = ScadletProjectV6

/** The viewer's own default camera state (matches `GeometryViewer`'s initial, pre-fit camera position/target). */
export const DEFAULT_VIEWER_CAMERA: ScadletViewerCamera = {
  position: [80, 80, 60],
  target: [0, 0, 0],
}

/** Default name for a project that hasn't been explicitly named yet - never used as an actual save filename without user confirmation (see `filename.ts`/`file-service.ts`). */
export const UNTITLED_PROJECT_NAME = 'Untitled Project'

/** Builds a fresh, empty project: no nodes/connections, a centered/unzoomed viewport, and the viewer's default camera. */
export function createEmptyProject(name: string = UNTITLED_PROJECT_NAME, now: () => string = () => new Date().toISOString()): ScadletProjectV6 {
  const timestamp = now()
  return {
    format: SCADLET_FORMAT,
    version: SCADLET_VERSION,
    metadata: { name, createdAt: timestamp, updatedAt: timestamp },
    graph: { nodes: [], connections: [] },
    definitions: [],
    editor: { viewport: { x: 0, y: 0, zoom: 1 } },
    viewer: { camera: { ...DEFAULT_VIEWER_CAMERA } },
  }
}

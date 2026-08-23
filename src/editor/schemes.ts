import { ClassicPreset } from 'rete'
import type { GetSchemes } from 'rete'
import type { RenderSignal } from 'rete-area-plugin'
import type { Connection as ConnectionPluginSignal } from 'rete-connection-plugin'
import type { DataflowNode } from 'rete-engine'

/**
 * Every node must be able to evaluate itself into OpenSCAD via
 * `rete-engine`'s dataflow evaluation (see `evaluate.ts`), so `data()` is
 * baked into the shared node type rather than bolted on per node type.
 * `selected` mirrors the flag `AreaExtensions.selectableNodes` sets on the
 * node itself (see `editor.ts`/`render.ts`); it's declared here so the
 * renderer can read it without casting.
 */
type GeometryNode = ClassicPreset.Node & DataflowNode & { selected?: boolean }

/**
 * The graph is built entirely from `ClassicPreset.Node` (+ dataflow).
 * Concrete node types (e.g. `CubeNode`) extend it but don't need their
 * own schema entry. `Connection` stays parameterized by the plain node
 * type (matching how rete's own `ClassicScheme`/`DataflowEngineScheme`
 * are shaped) since connections never need to know about `data()`;
 * parameterizing it by `GeometryNode` too breaks structural compatibility
 * with `AreaPlugin`/`ConnectionPlugin`, which are typed against the plain
 * node.
 */
export type Schemes = GetSchemes<
  GeometryNode,
  ClassicPreset.Connection<ClassicPreset.Node, ClassicPreset.Node>
>

type SocketRenderSignal = RenderSignal<
  'socket',
  { nodeId: string; side: 'input' | 'output'; key: string }
>

/**
 * Signals produced/required by the plugins layered onto the area, beyond
 * the node/connection/unmount signals `AreaPlugin` already provides:
 * per-socket render signals (consumed by our custom renderer in
 * `render.ts` and by `rete-render-utils`'s position tracker) and the
 * connection plugin's own pick/drop signals for drag-to-connect.
 */
export type AreaExtra = SocketRenderSignal | ConnectionPluginSignal

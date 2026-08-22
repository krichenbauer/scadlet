import { ClassicPreset } from 'rete'
import type { GetSchemes } from 'rete'
import type { RenderSignal } from 'rete-area-plugin'
import type { Connection as ConnectionPluginSignal } from 'rete-connection-plugin'

/**
 * The only socket type needed for Milestone 1: a 3D geometry value
 * flowing from one node's output into another node's input.
 */
export const geometrySocket = new ClassicPreset.Socket('geometry')

/**
 * The graph is built entirely from `ClassicPreset.Node`. Concrete node
 * types (e.g. `CubeNode`) extend it but don't need their own schema entry.
 */
export type Schemes = GetSchemes<
  ClassicPreset.Node,
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

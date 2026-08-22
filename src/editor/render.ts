import { ClassicPreset } from 'rete'
import type { Scope } from 'rete'
import type { AreaPlugin } from 'rete-area-plugin'
import type { ConnectionPlugin } from 'rete-connection-plugin'
import { classicConnectionPath, getDOMSocketPosition } from 'rete-render-utils'

import type { AreaExtra, Schemes } from './schemes'

type Position = { x: number; y: number }
type Side = 'input' | 'output'

const CONNECTION_CURVATURE = 0.3

interface ConnectionState {
  path: SVGPathElement
  start?: Position
  end?: Position
  unlistenSource?: () => void
  unlistenTarget?: () => void
}

/**
 * Minimal hand-written replacement for `rete-lit-plugin`. That package's
 * published dist bundle is compiled with legacy Babel decorators, which
 * are incompatible with Lit 3's decorator runtime (`proto.constructor
 * .createProperty is not a function`) - not a config problem we can work
 * around. Rather than depend on a broken renderer, nodes/connections are
 * rendered here with plain DOM, using the same framework-agnostic
 * `rete-render-utils` helpers the official React/Vue/Svelte plugins use
 * for socket-position tracking and connection path math.
 */
export function attachRenderer(
  area: AreaPlugin<Schemes, AreaExtra>,
  connection: ConnectionPlugin<Schemes, AreaExtra>,
): void {
  const socketPosition = getDOMSocketPosition<Schemes, AreaExtra>()
  // `attach()` only uses `connection` to walk up to its parent `area` via
  // `parentScope()`; its `Scope<never, ...>` parameter type doesn't reflect
  // that (a `ConnectionPlugin` actually produces signals), so this cast is
  // safe.
  socketPosition.attach(connection as unknown as Scope<never, [AreaExtra]>)

  const connections = new Map<HTMLElement, ConnectionState>()

  area.addPipe((context) => {
    if (context.type === 'render') {
      const { data } = context

      if (data.type === 'node') {
        renderNode(area, data.element, data.payload)
      } else if (data.type === 'connection') {
        updateConnection(
          connections,
          socketPosition,
          data.element,
          data.payload,
          data.start,
          data.end,
        )
      }
    } else if (context.type === 'unmount') {
      const state = connections.get(context.data.element)
      if (state) {
        state.unlistenSource?.()
        state.unlistenTarget?.()
        connections.delete(context.data.element)
      }
    }

    return context
  })
}

function renderNode(
  area: AreaPlugin<Schemes, AreaExtra>,
  element: HTMLElement,
  node: Schemes['Node'],
): void {
  element.classList.add('node')
  element.replaceChildren()

  const title = document.createElement('div')
  title.className = 'node-title'
  title.textContent = node.label
  element.appendChild(title)

  const outputs = document.createElement('div')
  outputs.className = 'node-outputs'
  element.appendChild(outputs)
  for (const [key, output] of Object.entries(node.outputs)) {
    if (!output) continue
    outputs.appendChild(renderPort(area, node.id, 'output', key, output.label))
  }

  const controls = document.createElement('div')
  controls.className = 'node-controls'
  element.appendChild(controls)
  for (const control of Object.values(node.controls)) {
    if (!control) continue
    const rendered = renderControl(control)
    if (rendered) controls.appendChild(rendered)
  }

  const inputs = document.createElement('div')
  inputs.className = 'node-inputs'
  element.appendChild(inputs)
  for (const [key, input] of Object.entries(node.inputs)) {
    if (!input) continue
    inputs.appendChild(renderPort(area, node.id, 'input', key, input.label))
  }
}

function renderPort(
  area: AreaPlugin<Schemes, AreaExtra>,
  nodeId: string,
  side: Side,
  key: string,
  label: string | undefined,
): HTMLElement {
  const row = document.createElement('div')
  row.className = `node-port node-port--${side}`

  const socket = document.createElement('div')
  socket.className = 'node-socket'
  row.appendChild(socket)

  const text = document.createElement('span')
  text.className = 'node-port-label'
  text.textContent = label ?? key
  row.appendChild(text)

  // Registers the socket with the connection plugin (drag-to-connect
  // hit-testing) and the position tracker (connection path anchoring).
  void area.emit({
    type: 'render',
    data: { type: 'socket', element: socket, nodeId, side, key },
  })
  void area.emit({
    type: 'rendered',
    data: { type: 'socket', element: socket, nodeId, side, key },
  })

  return row
}

function renderControl(control: ClassicPreset.Control): HTMLElement | null {
  if (!(control instanceof ClassicPreset.InputControl) || control.type !== 'number') {
    return null
  }

  const wrapper = document.createElement('label')
  wrapper.className = 'node-control'

  const input = document.createElement('input')
  input.type = 'number'
  input.value = String(control.value ?? '')
  input.disabled = control.readonly
  // Prevent the node-drag handler from starting when interacting with the input.
  input.addEventListener('pointerdown', (event) => event.stopPropagation())
  input.addEventListener('input', () => {
    control.setValue(input.valueAsNumber)
  })

  wrapper.appendChild(input)
  return wrapper
}

function updateConnection(
  connections: Map<HTMLElement, ConnectionState>,
  socketPosition: ReturnType<typeof getDOMSocketPosition<Schemes, AreaExtra>>,
  element: HTMLElement,
  payload: Schemes['Connection'],
  explicitStart: Position | undefined,
  explicitEnd: Position | undefined,
): void {
  let state = connections.get(element)

  if (!state) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    svg.classList.add('connection')
    svg.setAttribute('width', '0')
    svg.setAttribute('height', '0')

    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
    path.classList.add('connection-path')
    svg.appendChild(path)
    element.replaceChildren(svg)

    state = { path }
    connections.set(element, state)
  }

  const redraw = () => {
    if (state.start && state.end) {
      state.path.setAttribute(
        'd',
        classicConnectionPath([state.start, state.end], CONNECTION_CURVATURE),
      )
    }
  }

  // Real (non-pseudo) endpoints are tracked live via the socket position
  // watcher. A pseudo connection being dragged supplies the moving end's
  // position directly instead (its node id is `''`, nothing to track).
  if (payload.source && !state.unlistenSource) {
    state.unlistenSource = socketPosition.listen(
      payload.source,
      'output',
      String(payload.sourceOutput),
      (position) => {
        state.start = position
        redraw()
      },
    )
  }
  if (payload.target && !state.unlistenTarget) {
    state.unlistenTarget = socketPosition.listen(
      payload.target,
      'input',
      String(payload.targetInput),
      (position) => {
        state.end = position
        redraw()
      },
    )
  }
  if (explicitStart) state.start = explicitStart
  if (explicitEnd) state.end = explicitEnd

  redraw()
}

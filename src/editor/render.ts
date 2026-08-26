import { ClassicPreset } from 'rete'
import type { Scope } from 'rete'
import type { AreaPlugin } from 'rete-area-plugin'
import type { ConnectionPlugin } from 'rete-connection-plugin'
import { classicConnectionPath, getDOMSocketPosition } from 'rete-render-utils'

import { CheckboxControl, LabeledNumberControl, SelectControl } from './controls'
import { t } from '../i18n/translate'
import { bringNodeToFront } from './order'
import { isRedundantTypeLabel } from './ports'
import type { NodePresentationManager } from './presentation'
import type { AreaExtra, Schemes } from './schemes'

type Position = { x: number; y: number }
type Side = 'input' | 'output'

const CONNECTION_CURVATURE = 0.3
// Padding (in px) around a connection's start/end points when sizing its
// SVG. A connection's `<svg>` is sized to fit its own path rather than
// relying on `width: 0; height: 0; overflow: visible`: that trick works for
// plain elements, but Chromium does not paint an SVG root's overflowing
// content when the root itself has zero width/height, which made every
// connection invisible despite having a correct `d` attribute.
const CONNECTION_PADDING = 20

interface ConnectionState {
  svg: SVGSVGElement
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
  presentation: NodePresentationManager,
): void {
  const socketPosition = getDOMSocketPosition<Schemes, AreaExtra>()
  // `attach()` only uses `connection` to walk up to its parent `area` via
  // `parentScope()`; its `Scope<never, ...>` parameter type doesn't reflect
  // that (a `ConnectionPlugin` actually produces signals), so this cast is
  // safe.
  socketPosition.attach(connection as unknown as Scope<never, [AreaExtra]>)

  const connections = new Map<HTMLElement, ConnectionState>()
  // Tracks which node root elements already have hover listeners attached.
  // A node's root element is created once and reused across re-renders (only
  // its children are replaced - see `renderNode`), so listeners must only be
  // wired the first time a given element is seen, not on every re-render.
  const hoverWired = new WeakSet<HTMLElement>()

  area.addPipe((context) => {
    if (context.type === 'render') {
      const { data } = context

      if (data.type === 'node') {
        renderNode(area, data.element, data.payload, presentation, hoverWired)
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
      const { element } = context.data
      const state = connections.get(element)
      if (state) {
        state.unlistenSource?.()
        state.unlistenTarget?.()
        connections.delete(element)
      } else {
        // Not a tracked connection root, so this is either a socket (a
        // leaf with no further '.node-socket' descendants, making this a
        // no-op) or a whole node's root element being unmounted on
        // deletion. `renderNode()` only unmounts its own sockets when
        // re-rendering a node in place; a deleted node never re-renders,
        // so its sockets must be released here instead to avoid leaking
        // stale entries in the position tracker.
        for (const socket of element.querySelectorAll<HTMLElement>('.node-socket')) {
          void area.emit({ type: 'unmount', data: { element: socket } })
        }
      }
    }

    return context
  })
}

function renderNode(
  area: AreaPlugin<Schemes, AreaExtra>,
  element: HTMLElement,
  node: Schemes['Node'],
  presentation: NodePresentationManager,
  hoverWired: WeakSet<HTMLElement>,
): void {
  element.classList.add('node')
  element.classList.toggle('node--selected', Boolean(node.selected))

  // Feeds Rete's own selection flag into the presentation manager so a
  // touch/no-hover device can expand-on-select and collapse-on-deselect
  // (AGENTS.md section 5), reusing the existing selection mechanism
  // instead of separate touch-only state.
  presentation.syncSelection(node.id, Boolean(node.selected))

  const hasControls = Object.values(node.controls).some(Boolean)
  const expanded = hasControls && presentation.isExpanded(node.id)
  element.classList.toggle('node--expanded', expanded)

  // The node's root element persists across re-renders (only its children
  // are replaced below), so hover listeners are wired exactly once per
  // element rather than accumulating on every re-render.
  if (!hoverWired.has(element)) {
    hoverWired.add(element)
    element.addEventListener('pointerenter', () => {
      // Bring the node forward immediately on hover start, not after the
      // presentation manager's expand delay elapses, so an about-to-expand
      // node is never visually obscured by a neighbor once it does expand.
      bringNodeToFront(area, node.id)
      presentation.handlePointerEnter(node.id)
    })
    element.addEventListener('pointerleave', () => presentation.handlePointerLeave(node.id))
  }

  // Re-rendering a node (e.g. after `area.update('node', id)` for Cylinder's
  // progressive disclosure, or a presentation expand/collapse) replaces all
  // child DOM, including socket elements previously registered with the
  // position tracker via a 'render' signal in `renderPort`. Without an
  // explicit 'unmount' for each of those old elements, the tracker keeps
  // stale entries around (visible as a "Found more than one element for
  // socket..." console warning) and never lets go of detached nodes.
  for (const socket of element.querySelectorAll<HTMLElement>('.node-socket')) {
    void area.emit({ type: 'unmount', data: { element: socket } })
  }

  element.replaceChildren()

  // Connector layout is normalized project-wide (AGENTS.md section 9) AND
  // structurally isolated from the expandable controls body: `.node-main`
  // (inputs column | title/pin header | outputs column) is a self-
  // contained row whose height depends only on port count and the title,
  // never on whether `.node-controls` below it is currently rendered.
  // This is what keeps every existing connector anchor at a fixed screen
  // position across expand/collapse - previously inputs/outputs and the
  // controls-bearing body were siblings stretched to a shared height, so
  // adding/removing controls changed that shared height and shifted
  // ports that were vertically centered within it. A side column is only
  // rendered when the node actually has ports on that side (e.g. Cube/
  // Cylinder have no inputs at all).
  const main = document.createElement('div')
  main.className = 'node-main'

  if (Object.values(node.inputs).some(Boolean)) {
    const inputs = document.createElement('div')
    inputs.className = 'node-inputs'
    for (const [key, input] of Object.entries(node.inputs)) {
      if (!input) continue
      inputs.appendChild(renderPort(area, node.id, 'input', key, input.label, input.socket.name))
    }
    main.appendChild(inputs)
  }

  const body = document.createElement('div')
  body.className = 'node-body'
  body.appendChild(renderHeader(node, presentation, hasControls))
  main.appendChild(body)

  if (Object.values(node.outputs).some(Boolean)) {
    const outputs = document.createElement('div')
    outputs.className = 'node-outputs'
    for (const [key, output] of Object.entries(node.outputs)) {
      if (!output) continue
      outputs.appendChild(renderPort(area, node.id, 'output', key, output.label, output.socket.name))
    }
    main.appendChild(outputs)
  }

  element.appendChild(main)

  // Rendered as a full-width block BELOW the stable `.node-main` row
  // (rather than stacked inside it, as before) - growing/shrinking this
  // block only pushes the node's own bottom edge, never the header row's
  // layout above it, so it can never move an existing connector.
  if (expanded) {
    const controls = document.createElement('div')
    controls.className = 'node-controls'
    for (const [key, control] of Object.entries(node.controls)) {
      if (!control) continue
      const rendered = renderControl(key, control)
      if (rendered) controls.appendChild(rendered)
    }
    element.appendChild(controls)
  }
}

/**
 * Title plus the pin/expand header control (AGENTS.md sections 2, 6, 7).
 * A node with no controls at all (e.g. Difference) has nothing to
 * collapse/expand, so the pin affordance is only rendered "where
 * relevant" - i.e. when the node actually has a body worth hiding.
 */
function renderHeader(
  node: Schemes['Node'],
  presentation: NodePresentationManager,
  hasControls: boolean,
): HTMLElement {
  const header = document.createElement('div')
  header.className = 'node-header'

  const title = document.createElement('div')
  title.className = 'node-title'
  title.textContent = node.label
  header.appendChild(title)

  if (hasControls) {
    const pinned = presentation.isPinned(node.id)

    const pin = document.createElement('button')
    pin.type = 'button'
    pin.className = 'node-pin'
    pin.classList.toggle('node-pin--active', pinned)
    pin.setAttribute('aria-pressed', String(pinned))
    pin.setAttribute('aria-label', pinned ? t('node.unpin') : t('node.pin'))
    pin.textContent = '📌'
    // Prevent the node-drag handler from starting when interacting with the
    // pin button, mirroring the same pattern used for control inputs below.
    // Clicking the pin toggles pinning (which also expands/collapses the
    // node - see `NodePresentationManager.togglePin`); it never selects the
    // node or picks a socket.
    pin.addEventListener('pointerdown', (event) => event.stopPropagation())
    pin.addEventListener('click', () => presentation.togglePin(node.id))
    header.appendChild(pin)
  }

  return header
}

function renderPort(
  area: AreaPlugin<Schemes, AreaExtra>,
  nodeId: string,
  side: Side,
  key: string,
  label: string | undefined,
  socketName: string,
): HTMLElement {
  const row = document.createElement('div')
  row.className = `node-port node-port--${side}`

  const accessibleName = label ?? key

  const socket = document.createElement('div')
  socket.className = 'node-socket'
  // Presentation hook for socket type (AGENTS.md section 4): color is the
  // primary way a socket's data type is communicated, driven by this data
  // attribute in CSS (`node-editor.ts`) rather than by permanently showing
  // type text beside every connector.
  socket.dataset.socketType = socketName
  // The accessible name is always set, even when the visible label below
  // is omitted, so screen readers/tooltips never lose the socket's meaning.
  socket.title = accessibleName
  socket.setAttribute('aria-label', accessibleName)
  row.appendChild(socket)

  // A label that just restates the socket's data type (e.g. a lone
  // "Geometry" output) is redundant now that color communicates that
  // type; a label that disambiguates sibling ports on the same side (e.g.
  // Difference's "Base"/"Subtract") stays visible, since position alone
  // can't tell those apart.
  if (!isRedundantTypeLabel(label, socketName)) {
    const text = document.createElement('span')
    text.className = 'node-port-label'
    text.textContent = accessibleName
    row.appendChild(text)
  }

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

function renderControl(key: string, control: ClassicPreset.Control): HTMLElement | null {
  if (control instanceof CheckboxControl) {
    const wrapper = document.createElement('label')
    wrapper.className = 'node-control node-control--checkbox'

    const input = document.createElement('input')
    input.type = 'checkbox'
    input.checked = control.value
    // Prevent the node-drag handler from starting when interacting with the input.
    input.addEventListener('pointerdown', (event) => event.stopPropagation())
    input.addEventListener('change', () => control.setValue(input.checked))

    const text = document.createElement('span')
    text.textContent = control.label

    wrapper.append(input, text)
    return wrapper
  }

  if (control instanceof SelectControl) {
    const wrapper = document.createElement('label')
    wrapper.className = 'node-control'

    const text = document.createElement('span')
    text.className = 'node-control-label'
    text.textContent = control.label
    wrapper.appendChild(text)

    const select = document.createElement('select')
    for (const option of control.options) {
      const optionElement = document.createElement('option')
      optionElement.value = option.value
      optionElement.textContent = option.label
      optionElement.selected = option.value === control.value
      select.appendChild(optionElement)
    }
    select.addEventListener('pointerdown', (event) => event.stopPropagation())
    select.addEventListener('change', () => control.setValue(select.value))
    wrapper.appendChild(select)

    return wrapper
  }

  if (control instanceof ClassicPreset.InputControl && control.type === 'number') {
    const wrapper = document.createElement('label')
    wrapper.className = 'node-control'

    const text = document.createElement('span')
    text.className = 'node-control-label'
    text.textContent = control instanceof LabeledNumberControl ? control.label : key
    wrapper.appendChild(text)

    const input = document.createElement('input')
    input.type = 'number'
    input.value = String(control.value ?? '')
    input.disabled = control.readonly
    input.addEventListener('pointerdown', (event) => event.stopPropagation())
    input.addEventListener('input', () => control.setValue(input.valueAsNumber))
    wrapper.appendChild(input)

    return wrapper
  }

  return null
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

    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
    path.classList.add('connection-path')
    svg.appendChild(path)
    element.replaceChildren(svg)

    state = { svg, path }
    connections.set(element, state)
  }

  const redraw = () => {
    if (!state.start || !state.end) return

    // Position/size the svg to a bounding box around both endpoints (with
    // padding) and draw the path in coordinates relative to that box, so
    // the path never has to render outside its own svg's bounds.
    const minX = Math.min(state.start.x, state.end.x) - CONNECTION_PADDING
    const minY = Math.min(state.start.y, state.end.y) - CONNECTION_PADDING
    const maxX = Math.max(state.start.x, state.end.x) + CONNECTION_PADDING
    const maxY = Math.max(state.start.y, state.end.y) + CONNECTION_PADDING

    state.svg.style.left = `${minX}px`
    state.svg.style.top = `${minY}px`
    state.svg.setAttribute('width', String(maxX - minX))
    state.svg.setAttribute('height', String(maxY - minY))

    const start = { x: state.start.x - minX, y: state.start.y - minY }
    const end = { x: state.end.x - minX, y: state.end.y - minY }
    state.path.setAttribute('d', classicConnectionPath([start, end], CONNECTION_CURVATURE))
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

import { ClassicPreset, type NodeEditor } from 'rete'
import type { Scope } from 'rete'
import type { AreaPlugin } from 'rete-area-plugin'
import type { ConnectionPlugin } from 'rete-connection-plugin'
import { classicConnectionPath, getDOMSocketPosition } from 'rete-render-utils'

import { CheckboxControl, LabeledNumberControl, LabeledTextControl, ModuleGeometryInputAddControl, ModuleGeometryInputEditControl, ModuleParameterAddControl, ModuleParameterEditControl, ParameterActionsControl, RepresentationSelectControl, SelectControl, TitleSelectControl, Vector3Control, type ParameterAction } from './controls'
import { ModuleInputsNode } from './nodes/module-interface-nodes'
import { ModuleOutputNode } from './nodes/module-interface-nodes'
import { FunctionOutputNode } from './nodes/function-interface-nodes'
import { isEditableTarget } from './deletion'
import { t } from '../i18n/translate'
import type { InspectManager } from './inspect'
import { BooleanOpNode } from './nodes/boolean-op-node'
import { bringNodeToFront } from './order'
import { isRedundantTypeLabel } from './ports'
import type { NodePresentationManager } from './presentation'
import type { AreaExtra, Schemes } from './schemes'
import { compatiblePortKeys, type ConnectionGestureManager } from './connection-gesture'
import { nearestSnapTarget, type SnapCandidate } from './connection-gesture'
import type { ConnectionSelectionManager } from './connection-selection'
import { canConnectSocketData } from './connection-compatibility'

type Position = { x: number; y: number }
type Side = 'input' | 'output'

interface PortPresentation {
  visibleLabel?: string
  accessibleLabel?: string
}

export interface ParameterRowPresentation {
  key: string
  visible: boolean
  connected: boolean
}

/**
 * Keeps the node-defined active input order authoritative. Connection and
 * gesture state only determine which rows are visible while compact; they
 * must never sort a connected row ahead of an earlier semantic parameter.
 */
export function parameterRowPresentation(
  canonicalKeys: readonly string[],
  expanded: boolean,
  connectedKeys: ReadonlySet<string>,
  disclosedKeys: ReadonlySet<string>,
): ParameterRowPresentation[] {
  return canonicalKeys.map((key) => ({
    key,
    connected: connectedKeys.has(key),
    visible: expanded || connectedKeys.has(key) || disclosedKeys.has(key),
  }))
}

export interface ClassifiedOutputPorts<T> {
  /** The single conventional output rendered in the stable `.node-outputs`
   * main row: every built-in geometry node's/`ModuleCallNode`'s `geometry`
   * key, plus a value source's `value` key. */
  main: [string, T][]
  /** Module Inputs's dynamic, per-Geometry-input `geometry:<id>` outputs -
   * rendered as their own typed-output rows, never in the main row. */
  dynamicGeometry: [string, T][]
  /** Module Inputs's dynamic, per-parameter typed (Number/Boolean/Vector3)
   * outputs, rendered as their own typed-output rows. */
  parameter: [string, T][]
}

/**
 * Single source of truth for where an output port renders. Root cause of
 * the duplicate Geometry output sockets on ordinary built-in nodes
 * (Cube/Sphere/etc.): the dynamic Module-Inputs typed-output row classified
 * ANY `geometry`-typed output (not just its own `geometry:<id>` keys) into
 * a second row, so every built-in node's single conventional `geometry`
 * output rendered once in the main row and once more in that second row.
 */
export function classifyOutputPorts<T extends { socket: { name: string } }>(
  outputs: Readonly<Record<string, T | undefined>>,
): ClassifiedOutputPorts<T> {
  const main: [string, T][] = []
  const dynamicGeometry: [string, T][] = []
  const parameter: [string, T][] = []
  for (const [key, output] of Object.entries(outputs)) {
    if (!output) continue
    if (key === 'geometry' || key === 'value') { main.push([key, output]); continue }
    if (key.startsWith('geometry:')) { dynamicGeometry.push([key, output]); continue }
    if (output.socket.name !== 'geometry') parameter.push([key, output])
  }
  return { main, dynamicGeometry, parameter }
}

/** Dynamic child slots keep their stable semantic ids while this supplies
 * the compact, localized visual/accessibility distinction. */
export function geometryInputPresentation(node: Schemes['Node'], key: string): PortPresentation | undefined {
  if (node instanceof ModuleOutputNode && key === 'geometry') {
    return { visibleLabel: t('input.geometry'), accessibleLabel: t('input.geometry') }
  }
  if (node instanceof FunctionOutputNode && key === 'result') {
    return { visibleLabel: t('input.functionResult'), accessibleLabel: t('input.functionResult') }
  }
  if (!(node instanceof BooleanOpNode) || !node.isInputPort(key)) return undefined
  return node.isExtensionPort(key)
    ? { visibleLabel: '+', accessibleLabel: t('input.addGeometryChild') }
    : { visibleLabel: '', accessibleLabel: t('input.geometryChild') }
}

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
  hitPath: SVGPathElement
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
  editor: NodeEditor<Schemes>,
  area: AreaPlugin<Schemes, AreaExtra>,
  connection: ConnectionPlugin<Schemes, AreaExtra>,
  presentation: NodePresentationManager,
  inspect: InspectManager,
  connectionGesture: ConnectionGestureManager,
  connectionSelection: ConnectionSelectionManager,
  notifyDirty: () => void,
  onInspect: (nodeId: string) => void,
  onNodeInteraction: () => void,
  onConnectionInteraction: (connectionId: string) => void,
): () => void {
  const socketPosition = getDOMSocketPosition<Schemes, AreaExtra>()
  // `attach()` only uses `connection` to walk up to its parent `area` via
  // `parentScope()`; its `Scope<never, ...>` parameter type doesn't reflect
  // that (a `ConnectionPlugin` actually produces signals), so this cast is
  // safe.
  socketPosition.attach(connection as unknown as Scope<never, [AreaExtra]>)

  const connections = new Map<HTMLElement, ConnectionState>()
  // Tracks which node root elements already have hover/dblclick listeners
  // attached. A node's root element is created once and reused across
  // re-renders (only its children are replaced - see `renderNode`), so
  // listeners must only be wired the first time a given element is seen,
  // not on every re-render.
  const nodeListenersWired = new WeakSet<HTMLElement>()
  let disclosedNodeId: string | null = null
  let snapFrame: number | null = null
  const clearDisclosure = (): void => {
    if (!disclosedNodeId) return
    presentation.setConnectionDisclosure(disclosedNodeId, new Set())
    disclosedNodeId = null
  }
  const setCandidate = (node: Schemes['Node'] | undefined): void => {
    const active = connectionGesture.active
    if (!active || !node) {
      clearDisclosure()
      connectionGesture.setCandidate(null)
      return
    }

    if (active.origin.side === 'output') {
      const matchingInputs = compatiblePortKeys(node.inputs, active.origin.socketType)
      if (matchingInputs.length === 0) {
        clearDisclosure()
        connectionGesture.setCandidate(null)
        return
      }
      if (disclosedNodeId !== node.id) clearDisclosure()
      // Geometry inputs are structural and always visible. Only compatible
      // parameter rows need temporary disclosure below the stable header.
      const parameterKeys = new Set(matchingInputs.filter((key) => node.inputs[key]?.socket.name !== 'geometry'))
      presentation.setConnectionDisclosure(node.id, parameterKeys)
      disclosedNodeId = parameterKeys.size > 0 ? node.id : null
      connectionGesture.setCandidate(node.id)
      return
    }

    // Starting from an input is still a valid Rete gesture. Outputs are
    // structurally visible already, so it records a compatible candidate
    // without manufacturing a second disclosure UI.
    if (compatiblePortKeys(node.outputs, active.origin.socketType).length === 0) {
      clearDisclosure()
      connectionGesture.setCandidate(null)
      return
    }
    clearDisclosure()
    connectionGesture.setCandidate(node.id)
  }
  const nodeAtPointer = (event: PointerEvent): Schemes['Node'] | undefined => {
    const elements = event.composedPath().filter((item): item is Element => item instanceof Element)
    // Pointer events observed inside the node-editor Shadow DOM carry their
    // real target in the composed path. The fallback stays within that same
    // root as `document.elementsFromPoint()` cannot see through a shadow
    // boundary.
    const rootNode = area.container.getRootNode()
    const fallback = rootNode instanceof ShadowRoot
      ? rootNode.elementsFromPoint(event.clientX, event.clientY)
      : document.elementsFromPoint(event.clientX, event.clientY)
    for (const element of [...elements, ...fallback]) {
      const root = element instanceof HTMLElement
        ? element.closest<HTMLElement>('.node')
        : element.parentElement?.closest<HTMLElement>('.node')
      if (!root || !area.container.contains(root)) continue
      const nodeId = root.dataset.nodeId
      if (nodeId) return editor.getNode(nodeId)
    }
    return undefined
  }
  const updateSnapTarget = (clientX: number, clientY: number): void => {
    const active = connectionGesture.active
    if (!active) return
    const candidates: SnapCandidate[] = []
    for (const socket of area.container.querySelectorAll<HTMLElement>('.node-socket')) {
      if (socket.getClientRects().length === 0) continue
      const root = socket.closest<HTMLElement>('.node')
      const nodeId = root?.dataset.nodeId
      const socketKey = socket.dataset.socketKey
      const side = socket.dataset.socketSide
      const socketType = socket.dataset.socketType
      if (!nodeId || !socketKey || (side !== 'input' && side !== 'output') ||
        (socketType !== 'geometry' && socketType !== 'number' && socketType !== 'vector3' && socketType !== 'boolean')) continue
      if (nodeId === active.origin.nodeId && socketKey === active.origin.socketKey && side === active.origin.side) continue
      const endpoint: { nodeId: string; key: string; side: 'input' | 'output' } = { nodeId, key: socketKey, side }
      // Do not advertise a target that the current single-input interaction
      // would replace rather than add to.
      const occupied = side === 'input' && editor.getConnections().some((connection) => connection.target === nodeId && connection.targetInput === socketKey)
      const rect = socket.getBoundingClientRect()
      candidates.push({
        nodeId, socketKey, side, socketType,
        x: rect.left + rect.width / 2, y: rect.top + rect.height / 2,
        canConnect: !occupied && canConnectSocketData(editor, {
          nodeId: active.origin.nodeId, key: active.origin.socketKey, side: active.origin.side,
        }, endpoint),
      })
    }
    connectionGesture.setSnapTarget(nearestSnapTarget(active.origin, candidates, { x: clientX, y: clientY }))
  }
  const handlePointerMove = (event: PointerEvent): void => {
    if (!connectionGesture.active) return
    setCandidate(nodeAtPointer(event))
    updateSnapTarget(event.clientX, event.clientY)
    // Disclosure can mount an input row during this same movement. Re-scan
    // after layout so the newly visible port is immediately eligible.
    if (snapFrame !== null) cancelAnimationFrame(snapFrame)
    snapFrame = requestAnimationFrame(() => {
      snapFrame = null
      updateSnapTarget(event.clientX, event.clientY)
    })
  }
  area.container.addEventListener('pointermove', handlePointerMove, { capture: true })
  const syncSnapPresentation = (): void => {
    for (const socket of area.container.querySelectorAll<HTMLElement>('.node-socket--snap-target')) socket.classList.remove('node-socket--snap-target')
    const snap = connectionGesture.active?.snapTarget
    if (!snap) {
      area.container.classList.remove('connection-gesture--snapped')
      return
    }
    const socket = area.nodeViews.get(snap.nodeId)?.element.querySelector<HTMLElement>(
      `.node-socket[data-socket-side="${snap.side}"][data-socket-key="${CSS.escape(snap.socketKey)}"]`,
    )
    socket?.classList.add('node-socket--snap-target')
    area.container.classList.add('connection-gesture--snapped')
  }
  const unsubscribeGesture = connectionGesture.subscribe((previous, current) => {
    // Beginning a fresh gesture, completing/cancelling one, or resetting the
    // editor must never leave an old target row temporarily visible.
    if (!current || !previous || previous.origin !== current.origin ||
      (previous.candidateNodeId !== null && current.candidateNodeId === null)) clearDisclosure()
    syncSnapPresentation()
  })

  area.addPipe((context) => {
    if (context.type === 'render') {
      const { data } = context

      if (data.type === 'node') {
        renderNode(editor, area, data.element, data.payload, presentation, inspect, connectionGesture, nodeListenersWired, notifyDirty, onInspect, onNodeInteraction)
      } else if (data.type === 'connection') {
        updateConnection(
          area,
          connections,
          socketPosition,
          data.element,
          data.payload,
          data.start,
          data.end,
          connectionGesture,
          connectionSelection,
          onConnectionInteraction,
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

  return () => {
    area.container.removeEventListener('pointermove', handlePointerMove, { capture: true })
    if (snapFrame !== null) cancelAnimationFrame(snapFrame)
    unsubscribeGesture()
    area.container.classList.remove('connection-gesture--snapped')
    clearDisclosure()
  }
}

function renderNode(
  editor: NodeEditor<Schemes>,
  area: AreaPlugin<Schemes, AreaExtra>,
  element: HTMLElement,
  node: Schemes['Node'],
  presentation: NodePresentationManager,
  inspect: InspectManager,
  connectionGesture: ConnectionGestureManager,
  nodeListenersWired: WeakSet<HTMLElement>,
  notifyDirty: () => void,
  onInspect: (nodeId: string) => void,
  onNodeInteraction: () => void,
): void {
  element.classList.add('node')
  element.dataset.nodeId = node.id
  element.classList.toggle('node--selected', Boolean(node.selected))

  const inspected = inspect.isInspected(node.id)
  element.classList.toggle('node--inspected', inspected)
  presentation.syncSelection(node.id, Boolean(node.selected))

  // Separate structural geometry inputs from semantic parameter inputs (number/vector3).
  // Geometry inputs go in the stable `.node-inputs` left column (always visible).
  // Parameter inputs get their own inline rows co-located with their associated controls,
  // and are only shown when the node is expanded or the specific input is connected.
  // This was the root cause of the Milestone 6 collapse regression: the old approach
  // rendered all inputs (including geometry) in one column and the `connected` flag
  // was set for ANY input connection, causing Translate/Rotate/Scale to permanently
  // expand whenever their geometry input was connected.
  const geometryInputs: [string, ClassicPreset.Input<ClassicPreset.Socket>][] = []
  const parameterInputs: [string, ClassicPreset.Input<ClassicPreset.Socket>][] = []
  for (const [key, input] of Object.entries(node.inputs)) {
    if (!input) continue
    // Function Output's single `result` port is never geometry-typed, but
    // (like Module Output's `geometry` input) is structural interface
    // infrastructure that must stay visible regardless of hover/pin state,
    // not a collapsible parameter row.
    if (input.socket.name === 'geometry' || (node instanceof FunctionOutputNode && key === 'result')) {
      geometryInputs.push([key, input])
    } else {
      parameterInputs.push([key, input])
    }
  }
  const outputClasses = classifyOutputPorts(node.outputs)
  const { dynamicGeometry: geometryOutputs, parameter: parameterOutputs } = outputClasses

  // Keys of parameter inputs that map 1-to-1 to a control of the same key.
  const paramInputKeys = new Set(parameterInputs.map(([key]) => key))
  const sourceNameControl = node.outputs.value && node.controls.name instanceof LabeledTextControl
    ? node.controls.name
    : undefined
  const titleSelectControl = Object.values(node.controls).find(
    (control): control is TitleSelectControl => control instanceof TitleSelectControl,
  )
  // Controls that don't have a co-located parameter input row go in `.node-controls` when expanded.
  const representationControls = Object.values(node.controls).filter(
    (control): control is RepresentationSelectControl => control instanceof RepresentationSelectControl,
  )
  const standaloneControls = Object.entries(node.controls).filter(
    ([key, ctrl]) => ctrl && !paramInputKeys.has(key) && !(ctrl instanceof RepresentationSelectControl) && !(ctrl instanceof TitleSelectControl) && !(sourceNameControl && key === 'name'),
  )
  // Literal value sources have no inputs, so their primary control is part
  // of the compact node rather than hidden behind hover/pinning. Other
  // standalone controls retain the normal progressive-disclosure behavior.
  const alwaysVisibleControls = standaloneControls.filter(
    ([key, control]) => (Boolean(sourceNameControl) && key === 'value' && parameterInputs.length === 0) || control instanceof ModuleParameterAddControl || control instanceof ModuleGeometryInputAddControl || (control instanceof ModuleParameterEditControl && control.open) || (control instanceof ModuleGeometryInputEditControl && control.open),
  )
  const expandableStandaloneControls = standaloneControls.filter(([key]) => !alwaysVisibleControls.some(([primary]) => primary === key))

  // A node has collapsible content if it has parameter inputs (whose rows can be shown/hidden)
  // or standalone controls (shown only when expanded). This drives pin-button visibility.
  const hasCollapsibleContent = parameterInputs.length > 0 || parameterOutputs.length > 0 || geometryOutputs.length > 0 || expandableStandaloneControls.length > 0 || representationControls.length > 0
  // Rete remains authoritative for the semantic endpoint. Presentation keeps
  // compact expansion state, while this direct read ensures a freshly
  // committed snapped wire immediately disables its fallback literal even if
  // an area re-render races the connection-created presentation update.
  const connectedInputKeys = new Set([
    ...presentation.getConnectedInputKeys(node.id),
    ...editor.getConnections()
      .filter((connection) => connection.target === node.id && parameterInputs.some(([key]) => key === connection.targetInput))
      .map((connection) => connection.targetInput),
  ])
  const disclosedInputKeys = presentation.getDisclosedInputKeys(node.id)
  // Hover/pin expansion: shows ALL parameter rows and standalone controls.
  // Distinguished from connection-forced expansion (which only shows specific connected rows)
  // so that an unconnected Translate with Z connected doesn't show X/Y/Vector rows.
  const expanded = hasCollapsibleContent && presentation.isInteractivelyExpanded(node.id)
  element.classList.toggle('node--expanded', presentation.isExpanded(node.id))

  if (!nodeListenersWired.has(element)) {
    nodeListenersWired.add(element)
    element.addEventListener('pointerenter', () => {
      bringNodeToFront(area, node.id)
      presentation.handlePointerEnter(node.id)
    })
    element.addEventListener('pointerleave', () => {
      presentation.handlePointerLeave(node.id)
    })
    element.addEventListener('focusin', () => presentation.handleFocusEnter(node.id))
    element.addEventListener('focusout', () => {
      queueMicrotask(() => {
        if (!element.contains(document.activeElement)) presentation.handleFocusLeave(node.id)
      })
    })
    element.addEventListener('pointerdown', (event) => {
      if (isEditableTarget(event.target)) return
      if (event.target instanceof Element && event.target.closest<HTMLElement>('.node-socket')) {
        return
      }
      if (connectionGesture.active) return
      onNodeInteraction()
      if (inspect.registerPointerDown(node.id)) onInspect(node.id)
    })
  }

  for (const socket of element.querySelectorAll<HTMLElement>('.node-socket')) {
    void area.emit({ type: 'unmount', data: { element: socket } })
  }

  element.replaceChildren()

  // `.node-main`: stable header row - geometry sockets + title/pin + geometry output.
  // Height depends only on geometry port count and title; never on parameter rows below.
  const main = document.createElement('div')
  main.className = 'node-main'

  if (geometryInputs.length > 0) {
    const inputs = document.createElement('div')
    inputs.className = 'node-inputs'
    for (const [key, input] of geometryInputs) {
      inputs.appendChild(renderPort(area, node.id, 'input', key, input.label, input.socket.name, geometryInputPresentation(node, key)))
    }
    main.appendChild(inputs)
  }

  const body = document.createElement('div')
  body.className = 'node-body'
  body.appendChild(renderHeader(node, presentation, hasCollapsibleContent, inspected, notifyDirty, sourceNameControl, titleSelectControl))
  main.appendChild(body)

  if (outputClasses.main.length > 0) {
    const outputs = document.createElement('div')
    outputs.className = 'node-outputs'
    for (const [key, output] of outputClasses.main) {
      outputs.appendChild(renderPort(area, node.id, 'output', key, output.label, output.socket.name, key === 'value' ? { visibleLabel: '', accessibleLabel: output.label } : undefined))
    }
    main.appendChild(outputs)
  }

  element.appendChild(main)

  const valueResult = inspect.getValueResult(node.id)
  if (valueResult !== null) {
    const result = document.createElement('div')
    result.className = 'node-inspect-value'
    result.textContent = `= ${valueResult}`
    result.setAttribute('aria-label', t('node.inspectedValue'))
    element.appendChild(result)
  }

  // Parameter input rows: socket + label + inline value control, rendered below `.node-main`.
  // A connection keeps its row visible while compact, but rendering always
  // follows the active node-defined input order. Expanded/pinned/focused and
  // disclosed views therefore retain semantic X/Y/Z, A/B, etc. ordering.
  if (parameterInputs.length > 0) {
    const inputsByKey = new Map(parameterInputs)
    const rows = parameterRowPresentation(
      parameterInputs.map(([key]) => key),
      expanded,
      connectedInputKeys,
      disclosedInputKeys,
    )

    const paramRows = document.createElement('div')
    paramRows.className = 'node-param-rows'
    // A representation select is intentionally rendered with its semantic
    // parameter, rather than among generic node controls. It remains visible
    // whenever that parameter has a visible row.
    for (const control of representationControls) {
      const visible = expanded || parameterInputs.some(([key]) => connectedInputKeys.has(key))
      if (visible) paramRows.appendChild(renderRepresentationHeader(control, connectedInputKeys.size > 0))
    }
    for (const { key, connected, visible } of rows) {
      const input = inputsByKey.get(key)
      if (!input) continue
      const control = node.controls[key] as ClassicPreset.Control | undefined
      paramRows.appendChild(
        renderParamRow(area, node.id, key, input.label ?? key, input.socket.name, visible, connected, control),
      )
    }
    element.appendChild(paramRows)
  }

  // Definition Inputs has typed value outputs rather than parameter inputs.
  // These rows reuse the normal port renderer and border-anchor convention;
  // only their semantic direction differs.
  if (geometryOutputs.length > 0) {
    const rows = document.createElement('div')
    rows.className = 'node-param-output-rows node-geometry-output-rows'
    for (const [key, output] of geometryOutputs) {
      const row = renderPort(area, node.id, 'output', key, output.label, output.socket.name)
      row.classList.add('node-param-output-row')
      if (node instanceof ModuleInputsNode && key.startsWith('geometry:')) {
        const edit = document.createElement('button'); edit.type = 'button'; edit.className = 'node-param-edit'; edit.textContent = '✎'; edit.setAttribute('aria-label', `Edit ${output.label ?? key}`)
        edit.addEventListener('pointerdown', (event) => event.stopPropagation())
        edit.addEventListener('click', () => node.beginGeometryInputEdit(key.slice('geometry:'.length)))
        row.appendChild(edit)
      }
      rows.appendChild(row)
    }
    element.appendChild(rows)
  }
  if (parameterOutputs.length > 0) {
    const rows = document.createElement('div')
    rows.className = 'node-param-output-rows'
    for (const [key, output] of parameterOutputs) {
      const row = renderPort(area, node.id, 'output', key, output.label, output.socket.name)
      row.classList.add('node-param-output-row')
      if (node instanceof ModuleInputsNode) {
        const edit = document.createElement('button'); edit.type = 'button'; edit.className = 'node-param-edit'; edit.textContent = '✎'; edit.setAttribute('aria-label', `Edit ${output.label ?? key}`)
        edit.addEventListener('pointerdown', (event) => event.stopPropagation())
        edit.addEventListener('click', () => node.beginParameterEdit(key.slice('parameter:'.length)))
        row.appendChild(edit)
      }
      rows.appendChild(row)
    }
    element.appendChild(rows)
  }

  // Standalone controls (mode selects, checkboxes, add/remove actions): only when expanded.
  if ((expanded && expandableStandaloneControls.length > 0) || alwaysVisibleControls.length > 0) {
    const controls = document.createElement('div')
    controls.className = 'node-controls'
    if (alwaysVisibleControls.length > 0) controls.classList.add('node-controls--primary')
    for (const [key, control] of [...alwaysVisibleControls, ...(expanded ? expandableStandaloneControls : [])]) {
      if (!control) continue
      const rendered = renderControl(key, control, Boolean(sourceNameControl && key === 'value'))
      if (rendered) controls.appendChild(rendered)
    }
    element.appendChild(controls)
  }
}

/**
 * Title plus the pin/expand header control (AGENTS.md sections 2, 6, 7).
 * A node with no collapsible content (e.g. Difference) has nothing to
 * collapse/expand, so the pin affordance is only rendered "where
 * relevant" - i.e. when the node actually has something to expand.
 */
function renderHeader(
  node: Schemes['Node'],
  presentation: NodePresentationManager,
  hasCollapsibleContent: boolean,
  inspected: boolean,
  notifyDirty: () => void,
  sourceNameControl: LabeledTextControl | undefined,
  titleSelectControl: TitleSelectControl | undefined,
): HTMLElement {
  const header = document.createElement('div')
  header.className = 'node-header'

  if (titleSelectControl) {
    const drag = document.createElement('span')
    drag.className = 'node-header-drag'
    drag.textContent = '⠇'
    drag.title = t('node.drag')
    drag.setAttribute('aria-label', t('node.drag'))
    header.appendChild(drag)
  }

  const title = sourceNameControl ? document.createElement('input') : titleSelectControl ? document.createElement('select') : document.createElement('div')
  title.className = 'node-title'
  if (title instanceof HTMLInputElement) {
    const nameControl = sourceNameControl!
    title.type = 'text'
    // A blank descriptive name deliberately falls back to the localized
    // type title. The persisted node type and generated expression remain
    // independent from this presentation-only string.
    title.value = nameControl.value || node.label
    title.setAttribute('aria-label', `${node.label} ${t('control.name')}`)
    title.addEventListener('pointerdown', (event) => event.stopPropagation())
    title.addEventListener('dblclick', (event) => event.stopPropagation())
    title.addEventListener('input', () => nameControl.setValue(title.value))
    title.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') title.blur()
    })
  } else if (title instanceof HTMLSelectElement) {
    const operationControl = titleSelectControl!
    title.setAttribute('aria-label', operationControl.accessibleLabel)
    title.title = `${node.label}: ${operationControl.options.find((option) => option.value === operationControl.value)?.label ?? operationControl.value}`
    for (const option of operationControl.options) {
      const item = document.createElement('option')
      item.value = option.value
      item.textContent = option.label
      item.selected = option.value === operationControl.value
      title.appendChild(item)
    }
    title.addEventListener('pointerdown', (event) => event.stopPropagation())
    title.addEventListener('dblclick', (event) => event.stopPropagation())
    title.addEventListener('change', async () => {
      const requested = title.value
      title.disabled = true
      try {
        if (!(await operationControl.requestValue(requested))) title.value = operationControl.value
        const selectedLabel = operationControl.options.find((option) => option.value === operationControl.value)?.label ?? operationControl.value
        title.title = `${node.label}: ${selectedLabel}`
      } catch {
        title.value = operationControl.value
      } finally {
        title.disabled = false
      }
    })
  } else {
    title.textContent = node.label
  }
  header.appendChild(title)

  if (inspected) {
    // A small, independent indicator (in addition to `.node--inspected`'s
    // outline on the whole node) so inspected state is legible even where
    // the outline itself is easy to miss, e.g. a quick glance at a busy
    // graph - never the sole indication (AGENTS.md-adjacent requirement).
    const badge = document.createElement('span')
    badge.className = 'node-inspect-badge'
    badge.textContent = '👁'
    badge.title = t('node.inspected')
    badge.setAttribute('aria-label', t('node.inspected'))
    header.appendChild(badge)
  }

  if (hasCollapsibleContent) {
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
    // node or picks a socket. Explicit pinning is persisted state (unlike
    // hover/selection-driven expansion), so it must also mark the project
    // dirty - `presentation.togglePin` itself has no notion of dirty
    // tracking (its `onChange` also fires for non-persisted hover/select
    // expansion), so this is called alongside it rather than folded in.
    pin.addEventListener('pointerdown', (event) => event.stopPropagation())
    pin.addEventListener('click', () => {
      presentation.togglePin(node.id)
      notifyDirty()
    })
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
  presentation?: PortPresentation,
): HTMLElement {
  const row = document.createElement('div')
  row.className = `node-port node-port--${side}`

  const accessibleName = presentation?.accessibleLabel ?? label ?? key

  const socket = document.createElement('div')
  socket.className = 'node-socket'
  // Presentation hook for socket type (AGENTS.md section 4): color is the
  // primary way a socket's data type is communicated, driven by this data
  // attribute in CSS (`node-editor.ts`) rather than by permanently showing
  // type text beside every connector.
  socket.dataset.socketType = socketName
  socket.dataset.socketSide = side
  socket.dataset.socketKey = key
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
  const visibleLabel = presentation?.visibleLabel ?? (!isRedundantTypeLabel(label, socketName) ? accessibleName : undefined)
  if (visibleLabel) {
    const text = document.createElement('span')
    text.className = 'node-port-label'
    text.textContent = visibleLabel
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

/**
 * A single parameter input row: [socket] [label] [optional inline value].
 * Placed below `.node-main` in `.node-param-rows`. When `visible=false`
 * (unconnected and node is collapsed) the row is hidden but its socket is
 * still registered with the position tracker so Rete never loses track of
 * it. Connected rows are always visible and rendered first in their section,
 * so their socket positions are stable during hover expand/collapse.
 */
function renderParamRow(
  area: AreaPlugin<Schemes, AreaExtra>,
  nodeId: string,
  key: string,
  label: string,
  socketName: string,
  visible: boolean,
  connected: boolean,
  control: ClassicPreset.Control | undefined,
): HTMLElement {
  const row = document.createElement('div')
  row.className = 'node-param-row'
  if (!visible) row.hidden = true
  row.dataset.paramKey = key
  if (connected) row.dataset.connected = 'true'

  const socket = document.createElement('div')
  socket.className = 'node-socket'
  socket.dataset.socketType = socketName
  socket.dataset.socketSide = 'input'
  socket.dataset.socketKey = key
  socket.title = label
  socket.setAttribute('aria-label', label)
  row.appendChild(socket)

  void area.emit({ type: 'render', data: { type: 'socket', element: socket, nodeId, side: 'input', key } })
  void area.emit({ type: 'rendered', data: { type: 'socket', element: socket, nodeId, side: 'input', key } })

  const labelEl = document.createElement('span')
  labelEl.className = 'node-param-label'
  labelEl.textContent = label
  row.appendChild(labelEl)

  if (control) {
    const valueEl = renderParamControlValue(control, connected)
    if (valueEl) row.appendChild(valueEl)
  }

  return row
}

/** Renders just the value element for a parameter row (no wrapper label, no pointerdown stop for drag-suppression - that's on the element itself). When `overridden` is true, the element is disabled: the connected value takes precedence over the inline literal. */
function renderParamControlValue(control: ClassicPreset.Control, overridden: boolean): HTMLElement | null {
  if (control instanceof LabeledNumberControl || (control instanceof ClassicPreset.InputControl && control.type === 'number')) {
    const input = document.createElement('input')
    input.type = 'number'
    input.value = overridden ? '' : String((control as ClassicPreset.InputControl<'number'>).value ?? '')
    input.disabled = overridden || (control as ClassicPreset.InputControl<'number'>).readonly
    if (overridden) input.title = t('control.overridden')
    input.className = 'node-param-value'
    input.addEventListener('pointerdown', (event) => event.stopPropagation())
    input.addEventListener('input', () => (control as ClassicPreset.InputControl<'number'>).setValue(input.valueAsNumber))
    return input
  }
  if (control instanceof CheckboxControl) {
    const input = document.createElement('input')
    input.type = 'checkbox'
    input.checked = overridden ? false : control.value
    input.indeterminate = overridden
    input.disabled = overridden
    if (overridden) input.title = t('control.overridden')
    input.className = 'node-param-value'
    input.addEventListener('pointerdown', (event) => event.stopPropagation())
    input.addEventListener('change', () => control.setValue(input.checked))
    return input
  }
  if (control instanceof Vector3Control) {
    const wrapper = document.createElement('span')
    wrapper.className = 'node-param-vector3'
    control.value.forEach((value, index) => {
      const input = document.createElement('input')
      input.type = 'number'
      input.value = overridden ? '' : String(value)
      input.disabled = overridden
      input.className = 'node-param-value'
      input.addEventListener('pointerdown', (event) => event.stopPropagation())
      input.addEventListener('input', () => {
        const next = [...control.value] as [number, number, number]
        next[index] = input.valueAsNumber
        control.setValue(next)
      })
      wrapper.appendChild(input)
    })
    return wrapper
  }
  return null
}

function renderControl(key: string, control: ClassicPreset.Control, hideLabel = false): HTMLElement | null {
  if (control instanceof ModuleGeometryInputEditControl) return control.open ? renderModuleGeometryInputEditControl(control) : null
  if (control instanceof ModuleGeometryInputAddControl) return renderModuleGeometryInputAddControl(control)
  if (control instanceof ModuleParameterEditControl) return control.open ? renderModuleParameterEditControl(control) : null
  if (control instanceof ModuleParameterAddControl) return renderModuleParameterAddControl(control)
  if (control instanceof ParameterActionsControl) {
    const wrapper = document.createElement('div')
    wrapper.className = 'node-control node-control--actions'
    for (const action of control.actions()) wrapper.appendChild(renderParameterAction(action))
    return wrapper
  }
  if (control instanceof CheckboxControl) {
    const wrapper = document.createElement('label')
    wrapper.className = 'node-control node-control--checkbox'

    const input = document.createElement('input')
    input.type = 'checkbox'
    input.checked = control.value
    // Prevent the node-drag handler from starting when interacting with the input.
    input.addEventListener('pointerdown', (event) => event.stopPropagation())
    input.addEventListener('change', () => control.setValue(input.checked))

    wrapper.appendChild(input)
    if (!hideLabel) {
      const text = document.createElement('span')
      text.textContent = control.label
      wrapper.appendChild(text)
    }
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
    const changeBlocked = control.options.some((option) => option.value !== control.value && control.canChange && !control.canChange(option.value))
    if (changeBlocked) select.title = t('control.removeConnectionsBeforeSwitch')
    for (const option of control.options) {
      const optionElement = document.createElement('option')
      optionElement.value = option.value
      optionElement.textContent = option.label
      optionElement.selected = option.value === control.value
      optionElement.disabled = option.value !== control.value && Boolean(control.canChange && !control.canChange(option.value))
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

    if (!hideLabel) {
      const text = document.createElement('span')
      text.className = 'node-control-label'
      text.textContent = control instanceof LabeledNumberControl ? control.label : key
      wrapper.appendChild(text)
    }

    const input = document.createElement('input')
    input.type = 'number'
    input.value = String(control.value ?? '')
    input.disabled = control.readonly
    input.addEventListener('pointerdown', (event) => event.stopPropagation())
    input.addEventListener('input', () => control.setValue(input.valueAsNumber))
    wrapper.appendChild(input)

    return wrapper
  }

  if (control instanceof LabeledTextControl || (control instanceof ClassicPreset.InputControl && control.type === 'text')) {
    const wrapper = document.createElement('label')
    wrapper.className = 'node-control'
    const text = document.createElement('span')
    text.className = 'node-control-label'
    text.textContent = control instanceof LabeledTextControl ? control.label : key
    const input = document.createElement('input')
    input.type = 'text'
    input.value = String((control as ClassicPreset.InputControl<'text'>).value ?? '')
    input.addEventListener('pointerdown', (event) => event.stopPropagation())
    input.addEventListener('input', () => (control as ClassicPreset.InputControl<'text'>).setValue(input.value))
    wrapper.append(text, input)
    return wrapper
  }

  return null
}

function renderModuleGeometryInputEditControl(control: ModuleGeometryInputEditControl): HTMLElement {
  const wrapper = renderModuleGeometryInputAddControl(control)
  if (!control.open || !control.inputId) return wrapper
  const id = control.inputId
  const up = document.createElement('button'); up.type = 'button'; up.textContent = '↑'; up.setAttribute('aria-label', 'Move geometry input up'); up.disabled = control.order === 0
  const down = document.createElement('button'); down.type = 'button'; down.textContent = '↓'; down.setAttribute('aria-label', 'Move geometry input down')
  for (const [button, move] of [[up, -1], [down, 1]] as const) { button.addEventListener('pointerdown', (event) => event.stopPropagation()); button.addEventListener('click', () => { void Promise.resolve(control.onMove(id, move)).then(() => control.hide()) }) }
  const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = t('definition.deleteGeometryInput'); remove.addEventListener('pointerdown', (event) => event.stopPropagation()); remove.addEventListener('click', () => { void Promise.resolve(control.onDelete(id)).then((deleted) => { if (deleted) control.hide() }).catch((error: unknown) => { control.error = error instanceof Error ? error.message : String(error); control.onChange() }) })
  wrapper.append(up, down, remove)
  return wrapper
}

function renderModuleGeometryInputAddControl(control: ModuleGeometryInputAddControl): HTMLElement {
  const wrapper = document.createElement('div'); wrapper.className = 'node-control node-control--module-parameter'
  if (!control.open) {
    const add = document.createElement('button'); add.type = 'button'; add.textContent = t('definition.addGeometryInput'); add.addEventListener('pointerdown', (event) => event.stopPropagation()); add.addEventListener('click', () => control.show()); wrapper.appendChild(add); return wrapper
  }
  const name = document.createElement('input'); name.type = 'text'; name.value = control.name; name.setAttribute('aria-label', t('definition.geometryInputName')); name.addEventListener('pointerdown', (event) => event.stopPropagation()); name.addEventListener('input', () => { control.name = name.value })
  const submit = document.createElement('button'); submit.type = 'button'; submit.textContent = control instanceof ModuleGeometryInputEditControl ? t('definition.save') : t('definition.add'); submit.addEventListener('pointerdown', (event) => event.stopPropagation()); submit.addEventListener('click', () => { void Promise.resolve(control.onSubmit(control.name)).then((saved) => { if (saved !== false) control.hide() }).catch((error: unknown) => { control.error = error instanceof Error ? error.message : String(error); control.onChange() }) })
  const cancel = document.createElement('button'); cancel.type = 'button'; cancel.textContent = t('definition.cancel'); cancel.addEventListener('pointerdown', (event) => event.stopPropagation()); cancel.addEventListener('click', () => control.hide())
  wrapper.append(name, submit, cancel)
  if (control.error) { const error = document.createElement('span'); error.className = 'node-control-error'; error.textContent = control.error; wrapper.appendChild(error) }
  return wrapper
}

function renderModuleParameterEditControl(control: ModuleParameterEditControl): HTMLElement {
  const wrapper = renderModuleParameterAddControl(control)
  if (!control.open || !control.parameterId) return wrapper
  const id = control.parameterId
  const up = document.createElement('button'); up.type = 'button'; up.textContent = '↑'; up.setAttribute('aria-label', 'Move parameter up'); up.disabled = control.order === 0
  up.addEventListener('pointerdown', (event) => event.stopPropagation())
  up.addEventListener('click', () => { void Promise.resolve(control.onMove(id, -1)).then(() => control.hide()) })
  const down = document.createElement('button'); down.type = 'button'; down.textContent = '↓'; down.setAttribute('aria-label', 'Move parameter down')
  down.addEventListener('pointerdown', (event) => event.stopPropagation())
  down.addEventListener('click', () => { void Promise.resolve(control.onMove(id, 1)).then(() => control.hide()) })
  const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = t('definition.deleteParameter'); remove.addEventListener('pointerdown', (event) => event.stopPropagation()); remove.addEventListener('click', () => {
    void Promise.resolve(control.onDelete(id))
      .then((deleted) => { if (deleted) control.hide() })
      .catch((error: unknown) => { control.error = error instanceof Error ? error.message : String(error); control.onChange() })
  })
  wrapper.append(up, down, remove)
  return wrapper
}

function renderModuleParameterAddControl(control: ModuleParameterAddControl): HTMLElement {
  const wrapper = document.createElement('div')
  wrapper.className = 'node-control node-control--module-parameter'
  if (!control.open) {
    const add = document.createElement('button')
    add.type = 'button'; add.textContent = t('definition.addParameter')
    add.addEventListener('pointerdown', (event) => event.stopPropagation())
    add.addEventListener('click', () => control.show())
    wrapper.appendChild(add)
    return wrapper
  }
  const name = document.createElement('input'); name.type = 'text'; name.placeholder = t('definition.parameterName'); name.value = control.name
  name.setAttribute('aria-label', t('definition.parameterName'))
  name.addEventListener('pointerdown', (event) => event.stopPropagation())
  name.addEventListener('input', () => { control.name = name.value })
  const type = document.createElement('select'); type.setAttribute('aria-label', t('definition.parameterType'))
  for (const value of ['number', 'boolean', 'vector3'] as const) { const option = document.createElement('option'); option.value = value; option.textContent = value === 'vector3' ? 'Vector3' : value[0].toUpperCase() + value.slice(1); option.selected = control.type === value; type.appendChild(option) }
  type.addEventListener('pointerdown', (event) => event.stopPropagation())
  type.addEventListener('change', () => {
    control.type = type.value as typeof control.type
    // A type change starts from that type's canonical valid literal; the
    // user may still edit it before Save, but no stale incompatible default
    // can accidentally be committed.
    if (control.type === 'number') control.defaultNumber = 0
    else if (control.type === 'boolean') control.defaultBoolean = false
    else control.defaultVector = [0, 0, 0]
    control.onChange()
  })
  wrapper.append(name, type)
  const defaultValue = control.type === 'boolean'
    ? (() => { const input = document.createElement('input'); input.type = 'checkbox'; input.checked = control.defaultBoolean; input.setAttribute('aria-label', t('definition.parameterDefault')); input.addEventListener('change', () => { control.defaultBoolean = input.checked }); return input })()
    : control.type === 'vector3'
      ? renderVectorDefault(control)
      : (() => { const input = document.createElement('input'); input.type = 'number'; input.value = String(control.defaultNumber); input.setAttribute('aria-label', t('definition.parameterDefault')); input.addEventListener('input', () => { control.defaultNumber = input.valueAsNumber }); return input })()
  defaultValue.addEventListener('pointerdown', (event) => event.stopPropagation())
  wrapper.appendChild(defaultValue)
  const submit = document.createElement('button'); submit.type = 'button'; submit.textContent = control instanceof ModuleParameterEditControl ? t('definition.save') : t('definition.add')
  submit.addEventListener('pointerdown', (event) => event.stopPropagation())
  submit.addEventListener('click', () => {
    void Promise.resolve(control.onSubmit({ name: control.name, type: control.type, default: control.type === 'number' ? control.defaultNumber : control.type === 'boolean' ? control.defaultBoolean : control.defaultVector }))
      .then((saved) => { if (saved !== false) control.hide() })
      .catch((error: unknown) => { control.error = error instanceof Error ? error.message : String(error); control.onChange() })
  })
  const cancel = document.createElement('button'); cancel.type = 'button'; cancel.textContent = t('definition.cancel'); cancel.addEventListener('pointerdown', (event) => event.stopPropagation()); cancel.addEventListener('click', () => control.hide())
  wrapper.append(submit, cancel)
  if (control.error) { const error = document.createElement('span'); error.className = 'node-control-error'; error.textContent = control.error; wrapper.appendChild(error) }
  return wrapper
}

function renderVectorDefault(control: ModuleParameterAddControl): HTMLElement {
  const wrapper = document.createElement('span')
  control.defaultVector.forEach((value, index) => {
    const input = document.createElement('input'); input.type = 'number'; input.value = String(value); input.setAttribute('aria-label', `${t('definition.parameterDefault')} ${index + 1}`)
    input.addEventListener('input', () => { const next = [...control.defaultVector] as [number, number, number]; next[index] = input.valueAsNumber; control.defaultVector = next })
    wrapper.appendChild(input)
  })
  return wrapper
}

function renderParameterAction(action: ParameterAction): HTMLElement {
  if (action.children) {
    const details = document.createElement('details')
    details.className = 'node-action-menu'
    const summary = document.createElement('summary')
    summary.textContent = action.label
    summary.addEventListener('pointerdown', (event) => event.stopPropagation())
    details.appendChild(summary)
    const options = document.createElement('div')
    options.className = 'node-action-menu-options'
    for (const child of action.children) options.appendChild(renderParameterAction(child))
    details.appendChild(options)
    return details
  }
  const button = document.createElement('button')
  button.type = 'button'
  button.textContent = action.label
  button.disabled = Boolean(action.disabled)
  if (action.title) button.title = action.title
  button.addEventListener('pointerdown', (event) => event.stopPropagation())
  if (action.run && !action.disabled) button.addEventListener('click', action.run)
  return button
}

function renderRepresentationHeader(
  control: RepresentationSelectControl,
  hasActiveConnections: boolean,
): HTMLElement {
  const header = document.createElement('label')
  header.className = 'node-param-header'
  const label = document.createElement('span')
  label.textContent = control.label
  header.appendChild(label)
  const select = document.createElement('select')
  select.setAttribute('aria-label', t('control.representation'))
  const changeBlocked = control.options.some((option) => option.value !== control.value && control.canChange && !control.canChange(option.value))
  if (hasActiveConnections || changeBlocked) select.title = t('control.removeConnectionsBeforeSwitch')
  for (const option of control.options) {
    const item = document.createElement('option')
    item.value = option.value
    item.textContent = option.label
    item.selected = option.value === control.value
    item.disabled = option.value !== control.value && Boolean(
      hasActiveConnections || (control.canChange && !control.canChange(option.value)),
    )
    select.appendChild(item)
  }
  select.addEventListener('pointerdown', (event) => event.stopPropagation())
  select.addEventListener('change', () => control.setValue(select.value))
  header.appendChild(select)
  return header
}

function updateConnection(
  area: AreaPlugin<Schemes, AreaExtra>,
  connections: Map<HTMLElement, ConnectionState>,
  socketPosition: ReturnType<typeof getDOMSocketPosition<Schemes, AreaExtra>>,
  element: HTMLElement,
  payload: Schemes['Connection'],
  explicitStart: Position | undefined,
  explicitEnd: Position | undefined,
  connectionGesture: ConnectionGestureManager,
  connectionSelection: ConnectionSelectionManager,
  onConnectionInteraction: (connectionId: string) => void,
): void {
  let state = connections.get(element)

  if (!state) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    svg.classList.add('connection')

    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
    path.classList.add('connection-path')
    const hitPath = document.createElementNS('http://www.w3.org/2000/svg', 'path')
    hitPath.classList.add('connection-hit-path')
    const sourceNode = payload.source ? area.nodeViews.get(payload.source) : undefined
    const sourceSocket = sourceNode?.element?.querySelector<HTMLElement>(
      `.node-socket[data-socket-side="output"][data-socket-key="${String(payload.sourceOutput)}"]`,
    )
    if (sourceSocket?.dataset.socketType) path.dataset.socketType = sourceSocket.dataset.socketType
    if (sourceSocket?.dataset.socketType) hitPath.dataset.socketType = sourceSocket.dataset.socketType
    const selectConnection = (event: Event): void => {
      if (!payload.source || !payload.target) return
      event.preventDefault()
      event.stopPropagation()
      onConnectionInteraction(payload.id)
      // The manager also requests an Area re-render so a later selection
      // change is reflected consistently. Apply this immediate class for
      // the current hit event as well; Area's asynchronous update should
      // not make a wire click appear to do nothing for a frame.
      state?.svg.classList.add('connection--selected')
    }
    hitPath.addEventListener('pointerdown', selectConnection)
    hitPath.addEventListener('click', selectConnection)
    svg.addEventListener('pointerdown', selectConnection)
    svg.append(path, hitPath)
    svg.dataset.realConnection = String(Boolean(payload.source && payload.target))
    svg.dataset.connectionId = payload.id
    element.replaceChildren(svg)

    state = { svg, path, hitPath }
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
    state.hitPath.setAttribute('d', classicConnectionPath([start, end], CONNECTION_CURVATURE))
    state.svg.classList.toggle('connection--selected', Boolean(payload.source && payload.target && connectionSelection.isSelected(payload.id)))
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

  // The Rete pseudo-connection normally terminates at the raw pointer. A
  // real snap candidate replaces only that presentation endpoint; no graph
  // mutation happens until the user releases/clicks.
  const snap = connectionGesture.active?.snapTarget
  if (snap && (!payload.target || !payload.source)) {
    const local = socketPosition.sockets.getPosition({ nodeId: snap.nodeId, side: snap.side, key: snap.socketKey })
    const view = area.nodeViews.get(snap.nodeId)
    if (local && view) {
      const anchor = { x: local.x + view.position.x + (snap.side === 'input' ? -12 : 12), y: local.y + view.position.y }
      if (payload.source) state.end = anchor
      else state.start = anchor
    }
  }

  redraw()
}

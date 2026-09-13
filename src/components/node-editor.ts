import { LitElement, css, html } from 'lit'
import { customElement, query } from 'lit/decorators.js'

import { createEditor, type SCADletEditor } from '../editor/editor'
import type { InspectEvaluation } from '../editor/evaluate'
import { FUNCTION_CALL_DRAG_MIME_TYPE, MODULE_CALL_DRAG_MIME_TYPE, NODE_DRAG_MIME_TYPE, NODE_DRAG_PARAMS_MIME_TYPE } from '../editor/node-catalog'
import { t } from '../i18n/translate'

/**
 * Hosts the Rete node graph. Owns the lifecycle of the underlying
 * editor/area instance and exposes a small imperative API (e.g.
 * `addCubeNode`) for the surrounding application shell to use.
 */
@customElement('node-editor')
export class NodeEditorElement extends LitElement {
  static styles = css`
    :host {
      display: block;
      position: relative;
      overflow: hidden;
      background: #202020;
      color: #eee;
      color-scheme: dark;
      user-select: none;
      -webkit-user-select: none;
      --geometry-socket-color: var(--scadlet-geometry-socket, #7ac0ff);
    }

    #canvas {
      position: absolute;
      inset: 0;
      outline: none;
    }

    .view-recovery-control {
      position: absolute;
      z-index: 30;
      top: 10px;
      right: 10px;
      display: grid;
      width: 30px;
      height: 30px;
      place-items: center;
      padding: 0;
      border: 1px solid #626262;
      border-radius: 4px;
      background: rgb(38 38 38 / 0.92);
      color: #e8e8e8;
      cursor: pointer;
    }

    .view-recovery-control:hover { background: #3a3a3a; border-color: #898989; }
    .view-recovery-control:focus-visible { outline: 2px solid rgb(122 192 255 / 0.7); outline-offset: 2px; }
    .view-recovery-control svg { width: 17px; height: 17px; fill: none; stroke: currentcolor; stroke-width: 1.8; }

    .visually-hidden {
      position: absolute;
      width: 1px;
      height: 1px;
      padding: 0;
      overflow: hidden;
      clip: rect(0, 0, 0, 0);
      white-space: nowrap;
      border: 0;
    }

    input,
    textarea,
    select,
    [contenteditable='true'] {
      user-select: text;
      -webkit-user-select: text;
    }

    .definition-frame-layer {
      position: absolute;
      inset: 0;
      overflow: visible;
      pointer-events: none;
    }

    .definition-frame {
      position: absolute;
      box-sizing: border-box;
      border: 2px solid rgb(113 184 255 / 0.8);
      border-radius: 10px;
      background: rgb(54 93 130 / 0.08);
      color: #b9dcff;
      font: 12px system-ui, sans-serif;
    }

    .definition-frame-title {
      position: absolute;
      top: -11px;
      left: 12px;
      padding: 1px 6px;
      border-radius: 3px;
      background: #202020;
      font-weight: 600;
      pointer-events: auto;
      cursor: grab;
    }

    .definition-frame-title:active {
      cursor: grabbing;
    }

    .definition-frame--scope-valid {
      border-color: #8be28b;
      box-shadow: 0 0 0 2px rgb(139 226 139 / 0.35);
    }

    .definition-frame--scope-invalid {
      border-color: #e58a8a;
      box-shadow: 0 0 0 2px rgb(229 138 138 / 0.3);
    }

    .editor-feedback {
      position: absolute;
      z-index: 20;
      left: 12px;
      bottom: 12px;
      max-width: 300px;
      padding: 6px 9px;
      border-radius: 4px;
      background: rgb(64 30 30 / 0.96);
      color: #ffd7d7;
      font: 12px system-ui, sans-serif;
      pointer-events: none;
    }

    /*
     * Connector layout is normalized project-wide (AGENTS.md section 9)
     * AND structurally isolated from the expandable controls body: a
     * node stacks a stable .node-main header row (inputs column | body
     * | outputs column) above an optional .node-controls block, rather
     * than sizing inputs/outputs to the combined header+controls height.
     * .node-main's own height depends only on port count/title, never
     * on whether .node-controls is currently rendered, so expanding or
     * collapsing a node's controls can never move an existing connector
     * anchor (see render.ts's renderNode) - it only grows/shrinks the
     * node downward from its unchanged top-left graph position.
     */
    .node {
      display: flex;
      flex-direction: column;
      gap: 4px;
      /* Wide enough, unconditionally (not just once expanded), to fit
         every current control row's content without growing further on
         expand - see the connector-stability comment on .node-main
         below for why a node's own width must not depend on whether
         .node-controls is currently rendered. */
      min-width: 160px;
      border-radius: 6px;
      border: 1px solid #666;
      background: #2a2a2a;
      color: #eee;
      font: 13px system-ui, sans-serif;
      box-shadow: 0 2px 6px rgb(0 0 0 / 0.4);
    }

    .node--geometry-output {
      /* A complete thin border makes Geometry flow scannable without
         changing node dimensions, border-radius clipping, or socket anchors. */
      border-color: var(--geometry-socket-color);
    }

    .node--selected {
      border-color: #7ac0ff;
      box-shadow: 0 0 0 2px rgb(122 192 255 / 0.6), 0 2px 6px rgb(0 0 0 / 0.4);
    }

    /*
     * Inspect Node's visual treatment (AGENTS.md-adjacent feature) is
     * deliberately an outline rather than another border/box-shadow
     * combination, so it renders as a visually distinct layer that can
     * coexist with .node--selected above on the same node at once,
     * instead of the two competing for the same border/shadow.
     */
    .node--inspected {
      outline: 2px solid #f2b134;
      outline-offset: 2px;
    }

    .node--inspect-out-of-scope { opacity: 0.5; }
    .node--inspect-out-of-scope.node--selected { opacity: 0.72; }

    .node-inspect-badge {
      flex: none;
      font-size: 12px;
      line-height: 1;
      cursor: default;
    }

    .node-inspect-value {
      padding: 0 10px 7px;
      color: #ffe39a;
      font: 12px ui-monospace, monospace;
    }

    .node-main {
      display: flex;
      align-items: stretch;
    }

    .node-body {
      display: flex;
      align-items: center;
      flex: 1;
      min-width: 0;
      padding: 8px 10px;
    }

    .node-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 6px;
      min-width: 0;
    }

    .node-title {
      font-weight: 600;
      overflow-wrap: anywhere;
    }

    input.node-title {
      width: 100%;
      min-width: 0;
      padding: 1px 3px;
      border: 1px solid transparent;
      border-radius: 3px;
      background: transparent;
      color: inherit;
      font: inherit;
      font-weight: 600;
    }

    /* Native selects need explicit colors: Chromium otherwise supplies a
       light palette control and a transparent header select, neither of
       which is reliably legible against the dark node surface. Keeping this
       shared rule covers title, representation, and other node selects. */
    .node select {
      box-sizing: border-box;
      min-height: 26px;
      padding: 2px 6px;
      border: 1px solid #666;
      border-radius: 4px;
      background: #202020;
      color: #f5f5f5;
      color-scheme: dark;
      font: inherit;
    }

    .node select:hover { border-color: #989898; background: #292929; }
    .node select:focus-visible {
      border-color: #7ac0ff;
      outline: 2px solid rgb(122 192 255 / 0.45);
      outline-offset: 1px;
    }
    .node select:disabled { color: #999; border-color: #4a4a4a; background: #242424; }
    .node select option { background: #202020; color: #f5f5f5; }

    select.node-title {
      flex: 1 1 auto;
      width: auto;
      min-width: 64px;
      padding-right: 6px;
      font-weight: 600;
    }

    input.node-title:hover,
    input.node-title:focus {
      border-color: #666;
      outline: none;
    }

    .node-collapse {
      flex: none;
      width: 32px;
      height: 32px;
      margin: -6px -6px -6px 0;
      padding: 0;
      border: 1px solid transparent;
      border-radius: 4px;
      background: transparent;
      color: inherit;
      font-size: 14px;
      line-height: 30px;
      cursor: pointer;
      opacity: 0.8;
    }

    .node-collapse:hover {
      opacity: 1;
      background: rgb(122 192 255 / 0.16);
    }

    .node-collapse:focus-visible {
      opacity: 1;
      border-color: #7ac0ff;
      outline: 2px solid rgb(122 192 255 / 0.45);
      outline-offset: 1px;
    }

    /* Rendered as a full-width block below .node-main (see .node's comment above) - its own padding replaces the spacing .node-body's padding used to provide when controls were nested inside it. */
    .node-controls {
      display: flex;
      flex-direction: column;
      gap: 4px;
      padding: 0 10px 8px;
      /* Flex items default to a content-based automatic minimum size,
         which would let a control row's intrinsic content (e.g. a
         select's widest option) grow the node wider than its collapsed
         width - moving the far-right output socket horizontally on
         expand even though .node--expanded sets no min-width of its
         own. min-width: 0 here (and on .node-control below) opts back
         into normal shrink-to-fit behavior instead. */
      min-width: 0;
    }

    .node-inputs,
    .node-outputs {
      display: flex;
      flex-direction: column;
      justify-content: center;
      gap: 8px;
      padding: 8px 0;
    }

    .node-inputs {
      align-items: flex-start;
    }

    .node-outputs {
      align-items: flex-end;
    }

    .node-port {
      display: flex;
      align-items: center;
      gap: 6px;
      min-width: 0;
    }

    /* Outputs reverse the (socket, label) DOM order visually, so the socket - not the label - stays flush with the node's outer edge. */
    .node-port--output {
      flex-direction: row-reverse;
    }

    .node-port-label {
      white-space: nowrap;
    }

    .node-socket {
      width: 10px;
      height: 10px;
      flex: none;
      border-radius: 50%;
      border: 1px solid #2a6fb0;
      cursor: crosshair;
    }

    /*
     * Socket color communicates the value/data type (AGENTS.md section
     * 4); visible port labels are reserved for disambiguating sibling
     * ports on the same side (e.g. Difference's Base vs Subtract), not
     * for restating the type - see ports.ts's isRedundantTypeLabel.
     * A future non-geometry socket type would get its own rule here
     * (e.g. a neutral/grey [data-socket-type='number']) rather than a
     * full type-color framework.
     */
    .node-socket[data-socket-type='geometry'] {
      background: var(--geometry-socket-color);
    }

    .node-socket[data-socket-type='number'] {
      background: #f2b84b;
      border-color: #9d6a12;
    }

    .node-socket[data-socket-type='vector3'] {
      background: #b07cff;
      border-color: #6f42b5;
    }

    .node-socket[data-socket-type='boolean'] {
      background: #63c174;
      border-color: #2f8240;
    }

    /* Function Output and Conditional branch/result ports before their type
       is resolved use this deliberately neutral/grey socket, distinct from
       every real value type. */
    .node-socket[data-socket-type='unresolved'] {
      background: #888;
      border-color: #555;
    }

    .node-socket--snap-target {
      outline: 3px solid rgb(255 255 255 / 0.8);
      outline-offset: 2px;
      transform: scale(1.25);
    }

    #canvas.connection-gesture--snapped .node-socket--snap-target {
      cursor: copy;
    }

    /* Pulls just the socket circle to straddle the node's outer border, keeping the label anchored beside it. */
    .node-port--input .node-socket {
      margin-left: -6px;
    }

    .node-port--output .node-socket {
      margin-right: -6px;
    }

    .node-control {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 6px;
      min-width: 0;
    }

    .node-control--checkbox {
      justify-content: flex-start;
    }

    .node-control input[type='number'] {
      width: 64px;
      box-sizing: border-box;
    }

    .node-control input[type='text'] {
      width: 92px;
      min-width: 0;
      box-sizing: border-box;
    }

    .node-control select {
      font: inherit;
      /* An explicit width (rather than intrinsic/auto) keeps a <select>'s
         own widest-option content from growing the node wider than its
         collapsed baseline when controls first render on expand - the
         same connector-stability concern as the min-width: 0 rules
         above, but for a form control whose auto width is content-
         driven regardless of an ancestor's min-width. */
      width: 84px;
    }

    .node-control--actions {
      justify-content: flex-start;
      gap: 4px;
    }

    .node-action-menu {
      position: relative;
    }

    .node-action-menu > summary {
      cursor: pointer;
      list-style: none;
    }

    .node-action-menu > summary::-webkit-details-marker {
      display: none;
    }

    .node-action-menu-options {
      position: absolute;
      z-index: 2;
      display: flex;
      flex-direction: column;
      gap: 2px;
      min-width: 82px;
      padding: 4px;
      border: 1px solid #666;
      border-radius: 4px;
      background: #242424;
      box-shadow: 0 2px 6px rgb(0 0 0 / 0.4);
    }

    .node-param-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 6px;
      padding: 2px 10px 2px 4px;
      font-size: 11px;
      font-weight: 600;
    }

    .node-param-header select {
      width: 78px;
      font: inherit;
    }

    /*
     * Parameter input rows: socket on the far left (straddling the border
     * via margin-left: -6px, same as .node-port--input sockets), then a
     * short label, then the inline value input. Rendered below .node-main
     * in a separate section so adding/removing rows never moves the
     * geometry sockets in .node-main above. Connected rows are rendered
     * first and are always visible; unconnected rows appear only when
     * the node is expanded. This ordering ensures a connected socket's
     * position is identical before and after hover expand/collapse.
     */
    .node-param-rows {
      display: flex;
      flex-direction: column;
      gap: 1px;
      padding-right: 10px;
      padding-bottom: 4px;
      min-width: 0;
    }

    .node-param-row {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 2px 0;
      min-width: 0;
    }

    /* Explicitly hidden author rule to beat the UA [hidden]{display:none} specificity tie. */
    .node-param-row[hidden] {
      display: none;
    }

    /* Straddles the left border exactly like .node-port--input .node-socket */
    .node-param-row .node-socket {
      margin-left: -6px;
      flex: none;
    }

    .node-param-output-rows {
      display: flex;
      flex-direction: column;
      gap: 1px;
      padding-left: 10px;
      padding-bottom: 4px;
      min-width: 0;
    }

    .node-param-output-row {
      justify-content: flex-start;
      padding: 2px 0;
      width: 100%;
      box-sizing: border-box;
    }

    .node-param-output-row .node-socket {
      margin-right: -6px;
    }
    .node-param-edit { margin-left: 2px; padding: 0 3px; }

    .node-param-vector3 { display: flex; gap: 2px; min-width: 0; }
    .node-param-vector3 .node-param-value { width: 38px; }
    .node-control-error { color: #ff9b9b; font-size: 11px; }

    .node-param-label {
      flex: none;
      font-size: 11px;
      min-width: 14px;
      opacity: 0.75;
      white-space: nowrap;
    }

    /* Connected parameter rows are more prominent; their label is full-opacity */
    .node-param-row[data-connected] .node-param-label {
      opacity: 1;
    }

    .node-param-value {
      flex: 1;
      min-width: 0;
      width: 60px;
      box-sizing: border-box;
      font: inherit;
      text-align: right;
    }

    .connection {
      overflow: visible;
      position: absolute;
    }

    .connection-path {
      fill: none;
      stroke: #7ac0ff;
      stroke-width: 2px;
      pointer-events: none;
    }

    .connection-path[data-socket-type='number'] { stroke: #f2b84b; }
    .connection-path[data-socket-type='vector3'] { stroke: #b07cff; }
    .connection-path[data-socket-type='boolean'] { stroke: #63c174; }

    .connection-hit-path {
      fill: none;
      stroke: transparent;
      stroke-width: 16px;
      pointer-events: stroke;
      cursor: pointer;
    }

    .connection--selected .connection-path {
      stroke-width: 4px;
      filter: drop-shadow(0 0 3px currentColor);
    }

    /*
     * Shift-drag marquee selection rectangle (see editor/marquee.ts).
     * Rendered as a plain viewport-space overlay directly in #canvas
     * (a sibling of Rete's own pan/zoomed content holder, not inside
     * it), positioned/sized from raw client coordinates - so it is
     * intentionally NOT affected by the current pan/zoom transform.
     */
    .marquee {
      position: absolute;
      z-index: 10;
      border: 1px solid #7ac0ff;
      background: rgb(122 192 255 / 0.15);
      pointer-events: none;
    }
  `

  @query('#canvas')
  private canvas!: HTMLDivElement

  private instance?: SCADletEditor
  private resolveReady!: (instance: SCADletEditor) => void
  private readonly readyPromise = new Promise<SCADletEditor>((resolve) => {
    this.resolveReady = resolve
  })

  render() {
    return html`
      <div id="canvas"></div>
      <button
        type="button"
        class="view-recovery-control"
        aria-label=${t('editor.fitGraph')}
        title=${t('editor.fitGraph')}
        @pointerdown=${this._stopRecoveryControlGesture}
        @click=${this._fitGraph}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 4H4v5M15 4h5v5M20 15v5h-5M4 15v5h5M8 8l3 3M16 8l-3 3M8 16l3-3M16 16l-3-3" /></svg>
        <span class="visually-hidden">${t('editor.fitGraph')}</span>
      </button>
    `
  }

  async firstUpdated() {
    this.instance = await createEditor(this.canvas)
    this.resolveReady(this.instance)
    this.canvas.addEventListener('dragover', this._onDragOver)
    this.canvas.addEventListener('drop', this._onDrop)
  }

  disconnectedCallback() {
    super.disconnectedCallback()
    this.canvas?.removeEventListener('dragover', this._onDragOver)
    this.canvas?.removeEventListener('drop', this._onDrop)
    this.instance?.destroy()
  }

  /** Allows static-node or Module/Function-Call palette drags on the canvas. */
  private readonly _onDragOver = (event: DragEvent): void => {
    if (!event.dataTransfer?.types.some((type) => type === NODE_DRAG_MIME_TYPE || type === MODULE_CALL_DRAG_MIME_TYPE || type === FUNCTION_CALL_DRAG_MIME_TYPE)) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
  }

  private readonly _stopRecoveryControlGesture = (event: PointerEvent): void => {
    event.stopPropagation()
  }

  private readonly _fitGraph = (): void => {
    void this.instance?.fitVisibleContent()
  }

  /** Reads the dropped node type and places it under the pointer, converted to graph coordinates by the editor. */
  private readonly _onDrop = (event: DragEvent): void => {
    const type = event.dataTransfer?.getData(NODE_DRAG_MIME_TYPE)
    const paramsText = event.dataTransfer?.getData(NODE_DRAG_PARAMS_MIME_TYPE)
    const moduleDefinitionId = event.dataTransfer?.getData(MODULE_CALL_DRAG_MIME_TYPE)
    const functionDefinitionId = event.dataTransfer?.getData(FUNCTION_CALL_DRAG_MIME_TYPE)
    if (!type && !moduleDefinitionId && !functionDefinitionId) return
    event.preventDefault()
    if (type) {
      let params: Record<string, unknown> | undefined
      if (paramsText) {
        try {
          const parsed: unknown = JSON.parse(paramsText)
          if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) params = parsed as Record<string, unknown>
        } catch { return }
      }
      void this.addNodeAt(type, { x: event.clientX, y: event.clientY }, params)
    }
    else if (moduleDefinitionId) void this.addModuleCallAt(moduleDefinitionId, { x: event.clientX, y: event.clientY })
    else if (functionDefinitionId) void this.addFunctionCallAt(functionDefinitionId, { x: event.clientX, y: event.clientY })
  }

  async addNodeAt(type: string, clientPosition: { x: number; y: number }, params?: Record<string, unknown>): Promise<void> {
    await this.instance?.addNodeAt(type, clientPosition, params)
  }

  async addModuleCallAt(definitionId: string, clientPosition: { x: number; y: number }): Promise<boolean> {
    return (await this.instance?.addModuleCallAt(definitionId, clientPosition)) ?? false
  }

  async addFunctionCallAt(definitionId: string, clientPosition: { x: number; y: number }): Promise<boolean> {
    return (await this.instance?.addFunctionCallAt(definitionId, clientPosition)) ?? false
  }

  async evaluate(rootNodeId?: string): Promise<string> {
    return (await this.instance?.evaluate(rootNodeId)) ?? ''
  }

  async evaluateInspect(nodeId: string): Promise<InspectEvaluation> {
    return (await this.instance?.evaluateInspect(nodeId)) ?? { kind: 'missing' }
  }

  /** The node id currently selected as the Inspect Node preview root, or `null` if inspection is inactive. */
  getInspectedNodeId(): string | null {
    return this.instance?.getInspectedNodeId() ?? null
  }

  /**
   * The underlying editor instance, once initialized (`undefined` before
   * `firstUpdated` resolves). An escape hatch for project persistence
   * (`scadlet-app.ts`), which needs lower-level Rete/`AreaPlugin` access
   * (node positions, viewport, collapse state, dirty notifications) beyond
   * this element's small set of thin wrapper methods above.
   */
  getEditorInstance(): SCADletEditor | undefined {
    return this.instance
  }

  /** Resolves once the underlying editor instance has been created (i.e. after `firstUpdated`). */
  whenReady(): Promise<SCADletEditor> {
    return this.readyPromise
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'node-editor': NodeEditorElement
  }
}

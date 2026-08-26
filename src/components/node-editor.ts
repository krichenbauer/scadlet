import { LitElement, css, html } from 'lit'
import { customElement, query } from 'lit/decorators.js'

import { createEditor, type SCADletEditor } from '../editor/editor'
import { NODE_DRAG_MIME_TYPE } from '../editor/node-catalog'

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
    }

    #canvas {
      position: absolute;
      inset: 0;
      outline: none;
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

    .node--selected {
      border-color: #7ac0ff;
      box-shadow: 0 0 0 2px rgb(122 192 255 / 0.6), 0 2px 6px rgb(0 0 0 / 0.4);
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
      gap: 8px;
    }

    .node-title {
      font-weight: 600;
      overflow-wrap: anywhere;
    }

    .node-pin {
      flex: none;
      width: 20px;
      height: 20px;
      padding: 0;
      border: none;
      border-radius: 4px;
      background: transparent;
      color: inherit;
      font-size: 12px;
      line-height: 20px;
      cursor: pointer;
      opacity: 0.6;
    }

    .node-pin:hover {
      opacity: 1;
    }

    .node-pin--active {
      opacity: 1;
      background: rgb(122 192 255 / 0.25);
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
      background: #7ac0ff;
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
  `

  @query('#canvas')
  private canvas!: HTMLDivElement

  private instance?: SCADletEditor

  render() {
    return html`<div id="canvas"></div>`
  }

  async firstUpdated() {
    this.instance = await createEditor(this.canvas)
    this.canvas.addEventListener('dragover', this._onDragOver)
    this.canvas.addEventListener('drop', this._onDrop)
  }

  disconnectedCallback() {
    super.disconnectedCallback()
    this.canvas?.removeEventListener('dragover', this._onDragOver)
    this.canvas?.removeEventListener('drop', this._onDrop)
    this.instance?.destroy()
  }

  /** Allows a palette drag to be dropped on the canvas, but only for the node-type payload the palette produces. */
  private readonly _onDragOver = (event: DragEvent): void => {
    if (!event.dataTransfer?.types.includes(NODE_DRAG_MIME_TYPE)) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
  }

  /** Reads the dropped node type and places it under the pointer, converted to graph coordinates by the editor. */
  private readonly _onDrop = (event: DragEvent): void => {
    const type = event.dataTransfer?.getData(NODE_DRAG_MIME_TYPE)
    if (!type) return
    event.preventDefault()
    void this.addNodeAt(type, { x: event.clientX, y: event.clientY })
  }

  async addNodeAt(type: string, clientPosition: { x: number; y: number }): Promise<void> {
    await this.instance?.addNodeAt(type, clientPosition)
  }

  async addNodeAtCenter(type: string): Promise<void> {
    await this.instance?.addNodeAtCenter(type)
  }

  async evaluate(): Promise<string> {
    return (await this.instance?.evaluate()) ?? ''
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'node-editor': NodeEditorElement
  }
}

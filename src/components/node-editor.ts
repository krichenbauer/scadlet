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

    .node {
      display: flex;
      flex-direction: column;
      gap: 8px;
      min-width: 160px;
      padding: 8px 10px;
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

    .node-title {
      font-weight: 600;
    }

    .node-outputs,
    .node-inputs,
    .node-controls {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .node-port {
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .node-port--output {
      justify-content: flex-end;
    }

    .node-socket {
      width: 10px;
      height: 10px;
      flex: none;
      border-radius: 50%;
      background: #7ac0ff;
      border: 1px solid #2a6fb0;
      cursor: crosshair;
    }

    .node-control {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 6px;
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

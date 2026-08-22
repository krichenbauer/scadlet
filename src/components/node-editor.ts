import { LitElement, css, html } from 'lit'
import { customElement, query } from 'lit/decorators.js'

import { createEditor, type SCADletEditor } from '../editor/editor'

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
  }

  disconnectedCallback() {
    super.disconnectedCallback()
    this.instance?.destroy()
  }

  async addCubeNode() {
    await this.instance?.addCubeNode()
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

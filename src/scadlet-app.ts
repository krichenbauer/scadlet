import { LitElement, css, html } from 'lit'
import { customElement, query, state } from 'lit/decorators.js'

import './components/node-editor'
import './components/viewer-placeholder'
import type { NodeEditorElement } from './components/node-editor'

/**
 * The SCADlet application shell: a toolbar, the node-editor area, and a
 * placeholder for the future 3D viewer (Milestone 2). The OpenSCAD output
 * panel is a development-only aid for verifying graph evaluation until a
 * real viewer/export UI exists.
 */
@customElement('scadlet-app')
export class ScadletApp extends LitElement {
  static styles = css`
    :host {
      display: grid;
      grid-template-rows: auto 1fr;
      width: 100vw;
      height: 100vh;
      font-family: system-ui, sans-serif;
      color-scheme: light dark;
    }

    header {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 8px 12px;
      border-bottom: 1px solid #444;
    }

    header h1 {
      font-size: 14px;
      font-weight: 600;
      margin: 0;
    }

    button {
      font: inherit;
      padding: 4px 10px;
      cursor: pointer;
    }

    main {
      display: grid;
      grid-template-columns: 2fr 1fr;
      min-height: 0;
    }

    node-editor {
      border-right: 1px solid #444;
    }

    .side {
      display: grid;
      grid-template-rows: 1fr auto;
      min-height: 0;
    }

    .scad-output {
      margin: 0;
      padding: 8px;
      overflow: auto;
      max-height: 40%;
      border-top: 1px solid #444;
      font: 12px/1.4 ui-monospace, monospace;
      white-space: pre-wrap;
    }
  `

  @query('node-editor')
  private nodeEditor!: NodeEditorElement

  @state()
  private scadSource = ''

  render() {
    return html`
      <header>
        <h1>SCADlet</h1>
        <button type="button" @click=${this._addCube}>Add Cube</button>
        <button type="button" @click=${this._addCylinder}>Add Cylinder</button>
        <button type="button" @click=${this._addDifference}>Add Difference</button>
        <button type="button" @click=${this._evaluate}>Evaluate OpenSCAD</button>
      </header>
      <main>
        <node-editor></node-editor>
        <div class="side">
          <viewer-placeholder></viewer-placeholder>
          <pre class="scad-output">${this.scadSource || '// click "Evaluate OpenSCAD" to see the generated source'}</pre>
        </div>
      </main>
    `
  }

  private _addCube() {
    this.nodeEditor.addCubeNode()
  }

  private _addCylinder() {
    this.nodeEditor.addCylinderNode()
  }

  private _addDifference() {
    this.nodeEditor.addDifferenceNode()
  }

  private async _evaluate() {
    this.scadSource = await this.nodeEditor.evaluate()
    console.log(this.scadSource)
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'scadlet-app': ScadletApp
  }
}


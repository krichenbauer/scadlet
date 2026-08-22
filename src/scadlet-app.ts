import { LitElement, css, html } from 'lit'
import { customElement, query } from 'lit/decorators.js'

import './components/node-editor'
import './components/viewer-placeholder'
import type { NodeEditorElement } from './components/node-editor'

/**
 * The SCADlet application shell: a toolbar, the node-editor area, and a
 * placeholder for the future 3D viewer (Milestone 2).
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
  `

  @query('node-editor')
  private nodeEditor!: NodeEditorElement

  render() {
    return html`
      <header>
        <h1>SCADlet</h1>
        <button type="button" @click=${this._addCube}>Add Cube</button>
      </header>
      <main>
        <node-editor></node-editor>
        <viewer-placeholder></viewer-placeholder>
      </main>
    `
  }

  private _addCube() {
    this.nodeEditor.addCubeNode()
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'scadlet-app': ScadletApp
  }
}

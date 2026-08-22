import { LitElement, css, html, nothing } from 'lit'
import { customElement, query, state } from 'lit/decorators.js'

import './components/node-editor'
import './components/geometry-viewer'
import type { NodeEditorElement } from './components/node-editor'
import type { GeometryViewer } from './components/geometry-viewer'
import { RenderController } from './render/render-controller'
import { scadBlob, stlBlob, triggerDownload } from './render/download'

/**
 * The SCADlet application shell: a toolbar, the node-editor area, and the
 * Three.js preview (Milestone 2: Render/Stop -> Web Worker -> OpenSCAD
 * WASM -> STL -> viewer). The OpenSCAD output panel is a
 * development-only aid for verifying graph evaluation, not a code editor.
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

    button:disabled {
      cursor: default;
      opacity: 0.5;
    }

    .toolbar-gap {
      flex: 1;
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
      grid-template-rows: 1fr auto auto;
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

    geometry-viewer {
      min-height: 0;
    }

    .render-error {
      margin: 0;
      padding: 6px 10px;
      background: #4a1f1f;
      color: #ffb3b3;
      font: 12px/1.4 ui-monospace, monospace;
      white-space: pre-wrap;
      border-top: 1px solid #733;
    }
  `

  @query('node-editor')
  private nodeEditor!: NodeEditorElement

  @query('geometry-viewer')
  private viewer!: GeometryViewer

  private readonly renderController = new RenderController()

  @state()
  private scadSource = ''

  @state()
  private rendering = false

  @state()
  private renderError: string | null = null

  @state()
  private stl: ArrayBuffer | null = null

  render() {
    return html`
      <header>
        <h1>SCADlet</h1>
        <button type="button" @click=${this._addCube}>Add Cube</button>
        <button type="button" @click=${this._addCylinder}>Add Cylinder</button>
        <button type="button" @click=${this._addDifference}>Add Difference</button>
        <button type="button" @click=${this._evaluate}>Evaluate OpenSCAD</button>
        <span class="toolbar-gap"></span>
        <button type="button" @click=${this._render} ?disabled=${this.rendering}>
          ${this.rendering ? 'Rendering…' : 'Render'}
        </button>
        <button type="button" @click=${this._stop} ?disabled=${!this.rendering}>Stop</button>
        <button type="button" @click=${this._downloadScad} ?disabled=${!this.scadSource}>
          Download .scad
        </button>
        <button type="button" @click=${this._downloadStl} ?disabled=${!this.stl}>Download .stl</button>
      </header>
      <main>
        <node-editor></node-editor>
        <div class="side">
          <geometry-viewer></geometry-viewer>
          <pre class="scad-output">${this.scadSource || '// click "Evaluate OpenSCAD" to see the generated source'}</pre>
          ${this.renderError ? html`<pre class="render-error">${this.renderError}</pre>` : nothing}
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

  private async _render() {
    if (this.rendering) return

    const source = await this.nodeEditor.evaluate()
    this.scadSource = source

    if (!source.trim()) {
      this.renderError = 'Nothing to render - add at least one node.'
      return
    }

    this.rendering = true
    this.renderError = null
    try {
      const stl = await this.renderController.render(source)
      this.stl = stl
      this.viewer.showSTL(stl)
    } catch (error) {
      // A user-initiated Stop rejects the in-flight render; that's an
      // expected transition back to idle, not an error worth surfacing.
      const message = error instanceof Error ? error.message : String(error)
      if (message !== 'Render stopped') this.renderError = message
    } finally {
      this.rendering = false
    }
  }

  private _stop() {
    this.renderController.stop()
    this.rendering = false
  }

  private _downloadScad() {
    if (!this.scadSource) return
    triggerDownload(scadBlob(this.scadSource), 'scadlet-model.scad')
  }

  private _downloadStl() {
    if (!this.stl) return
    triggerDownload(stlBlob(this.stl), 'scadlet-model.stl')
  }

  disconnectedCallback() {
    super.disconnectedCallback()
    this.renderController.destroy()
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'scadlet-app': ScadletApp
  }
}


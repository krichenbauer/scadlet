import { LitElement, css, html, nothing } from 'lit'
import { customElement, query, state } from 'lit/decorators.js'
import { styleMap } from 'lit/directives/style-map.js'

import './components/node-editor'
import './components/geometry-viewer'
import './components/splitter'
import './components/node-palette'
import type { NodeEditorElement } from './components/node-editor'
import type { GeometryViewer } from './components/geometry-viewer'
import type { SCADletEditor } from './editor/editor'
import { toScadletFilename } from './persistence/filename'
import { createBrowserFileSystemCapability, pickFileWithInput, ProjectFileService } from './persistence/file-service'
import { UNTITLED_PROJECT_NAME, type ScadletProjectMetadata, type ScadletProjectV1 } from './persistence/project'
import { restoreProject } from './persistence/restore'
import { serializeProject } from './persistence/serialize'
import { RenderController } from './render/render-controller'
import { scadBlob, stlBlob, triggerDownload } from './render/download'

/** Pane size limits for the resizable workspace layout, in pixels. */
const MIN_EDITOR_WIDTH = 280
const MIN_PREVIEW_WIDTH = 240
const MIN_VIEWER_HEIGHT = 160
const MIN_OUTPUT_HEIGHT = 60
const SPLITTER_SIZE = 7
/** Fraction of the available space the editor/viewer pane gets by default. */
const DEFAULT_SPLIT_FRACTION = 0.65

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

    .project-name {
      font: inherit;
      padding: 4px 8px;
      min-width: 160px;
      background: transparent;
      color: inherit;
      border: 1px solid transparent;
      border-radius: 4px;
    }

    .project-name:hover,
    .project-name:focus {
      border-color: #666;
    }

    .dirty-indicator {
      color: #f2b134;
      font-size: 10px;
    }

    .toolbar-gap {
      flex: 1;
    }

    .workspace {
      display: grid;
      grid-template-columns: 200px minmax(0, 1fr);
      min-height: 0;
      min-width: 0;
    }

    node-palette {
      min-height: 0;
      border-right: 1px solid #444;
    }

    main {
      display: grid;
      grid-template-columns: minmax(0, var(--editor-width, 65%)) auto minmax(0, 1fr);
      min-height: 0;
      min-width: 0;
    }

    node-editor {
      min-width: 0;
      border-right: 1px solid #444;
    }

    .side {
      display: grid;
      grid-template-rows: minmax(0, var(--viewer-height, 65%)) auto minmax(0, 1fr);
      min-height: 0;
      min-width: 0;
    }

    .bottom-panel {
      display: flex;
      flex-direction: column;
      min-height: 0;
      overflow: hidden;
    }

    .scad-output {
      flex: 1;
      margin: 0;
      padding: 8px;
      overflow: auto;
      border-top: 1px solid #444;
      font: 12px/1.4 ui-monospace, monospace;
      white-space: pre-wrap;
    }

    geometry-viewer {
      min-height: 0;
      min-width: 0;
    }

    /* At narrow widths, fall back to a simple stacked layout instead of
       trying to keep the side-by-side split usable (AGENTS.md: desktop
       is the primary target, narrow widths just need to avoid breaking). */
    @media (max-width: 700px) {
      .workspace {
        display: flex !important;
        flex-direction: column !important;
      }

      node-palette {
        flex: none;
        max-height: 30vh;
      }

      main {
        display: flex !important;
        flex-direction: column !important;
      }

      main > node-editor,
      main > .side {
        flex: 1 1 50%;
        min-height: 200px;
      }

      main > layout-splitter[orientation='vertical'] {
        display: none;
      }
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

  @query('main')
  private mainEl!: HTMLElement

  @query('.side')
  private sideEl!: HTMLElement

  private readonly renderController = new RenderController()
  private mainResizeObserver?: ResizeObserver
  private sideResizeObserver?: ResizeObserver

  private readonly fileService = new ProjectFileService({
    capability: createBrowserFileSystemCapability(),
    pickFileFallback: pickFileWithInput,
    downloadFallback: (content, filename) =>
      triggerDownload(new Blob([content], { type: 'application/json' }), filename),
  })
  private unsubscribeDirty?: () => void
  private unsubscribeCameraDirty?: () => void
  /** Whether the user has ever explicitly set a project name (see `_ensureProjectName`) - distinct from the name merely still being the placeholder string, since a project could legitimately be named that on purpose. */
  private hasExplicitName = false

  @state()
  private projectMetadata: ScadletProjectMetadata = { name: UNTITLED_PROJECT_NAME }

  /** Unsaved-changes indicator. Covers node/connection add/remove/move, pin state, and project-name edits (see `editor/editor.ts`'s `onDirty` for what it does and does not cover). */
  @state()
  private dirty = false

  @state()
  private scadSource = ''

  /**
   * Always the full-model OpenSCAD source, independent of Inspect Node -
   * this is what ".scad" export must contain, even while `scadSource`
   * (the dev-panel display and what's actually sent to OpenSCAD WASM) is
   * showing an inspected subtree instead. Equal to `scadSource` whenever
   * nothing is being inspected.
   */
  @state()
  private exportSource = ''

  @state()
  private rendering = false

  @state()
  private renderError: string | null = null

  @state()
  private stl: ArrayBuffer | null = null

  /** Width, in pixels, of the node-editor pane. 0 means "not measured yet". */
  @state()
  private editorWidth = 0

  /** Height, in pixels, of the geometry-viewer pane. 0 means "not measured yet". */
  @state()
  private viewerHeight = 0

  render() {
    return html`
      <header>
        <h1>SCADlet</h1>
        <input
          type="text"
          class="project-name"
          .value=${this.projectMetadata.name}
          @change=${this._onProjectNameChange}
          aria-label="Project name"
        />
        ${this.dirty ? html`<span class="dirty-indicator" title="Unsaved changes">●</span>` : nothing}
        <span class="toolbar-gap"></span>
        <button type="button" @click=${this._open}>Open</button>
        <button type="button" @click=${this._save}>Save</button>
        <button type="button" @click=${this._saveAs}>Save As</button>
        <button type="button" @click=${this._render} ?disabled=${this.rendering}>
          ${this.rendering ? 'Rendering…' : 'Render'}
        </button>
        <button type="button" @click=${this._stop} ?disabled=${!this.rendering}>Stop</button>
        <button type="button" @click=${this._downloadScad} ?disabled=${!this.exportSource}>
          Download .scad
        </button>
        <button type="button" @click=${this._downloadStl} ?disabled=${!this.stl}>Download .stl</button>
      </header>
      <div class="workspace">
        <node-palette @node-palette-pick=${this._onPalettePick}></node-palette>
        <main style=${styleMap({ '--editor-width': this.editorWidth ? `${this.editorWidth}px` : undefined })}>
          <node-editor></node-editor>
          <layout-splitter orientation="vertical" @splitter-move=${this._onMainSplitterMove}></layout-splitter>
          <div
            class="side"
            style=${styleMap({ '--viewer-height': this.viewerHeight ? `${this.viewerHeight}px` : undefined })}
          >
            <geometry-viewer></geometry-viewer>
            <layout-splitter orientation="horizontal" @splitter-move=${this._onSideSplitterMove}></layout-splitter>
            <div class="bottom-panel">
              <pre class="scad-output">${this.scadSource || '// click "Render" to see the generated source'}</pre>
              ${this.renderError ? html`<pre class="render-error">${this.renderError}</pre>` : nothing}
            </div>
          </div>
        </main>
      </div>
    `
  }

  firstUpdated() {
    this.mainResizeObserver = new ResizeObserver(() => this._clampEditorWidth())
    this.mainResizeObserver.observe(this.mainEl)
    this.sideResizeObserver = new ResizeObserver(() => this._clampViewerHeight())
    this.sideResizeObserver.observe(this.sideEl)

    void this.nodeEditor.whenReady().then((instance) => {
      this.unsubscribeDirty = instance.onDirty(() => {
        this.dirty = true
      })
    })
    this.unsubscribeCameraDirty = this.viewer.onCameraChange(() => {
      this.dirty = true
    })
  }

  connectedCallback(): void {
    super.connectedCallback()
    window.addEventListener('keydown', this._onKeyDown)
  }

  private _clampEditorWidth(): void {
    const available = this.mainEl.clientWidth - SPLITTER_SIZE
    if (available <= 0) return
    const max = Math.max(MIN_EDITOR_WIDTH, available - MIN_PREVIEW_WIDTH)
    this.editorWidth =
      this.editorWidth === 0
        ? Math.min(Math.max(available * DEFAULT_SPLIT_FRACTION, MIN_EDITOR_WIDTH), max)
        : Math.min(Math.max(this.editorWidth, MIN_EDITOR_WIDTH), max)
  }

  private _clampViewerHeight(): void {
    const available = this.sideEl.clientHeight - SPLITTER_SIZE
    if (available <= 0) return
    const max = Math.max(MIN_VIEWER_HEIGHT, available - MIN_OUTPUT_HEIGHT)
    this.viewerHeight =
      this.viewerHeight === 0
        ? Math.min(Math.max(available * DEFAULT_SPLIT_FRACTION, MIN_VIEWER_HEIGHT), max)
        : Math.min(Math.max(this.viewerHeight, MIN_VIEWER_HEIGHT), max)
  }

  private _onMainSplitterMove(event: CustomEvent<{ clientX: number }>): void {
    const rect = this.mainEl.getBoundingClientRect()
    const available = rect.width - SPLITTER_SIZE
    const max = Math.max(MIN_EDITOR_WIDTH, available - MIN_PREVIEW_WIDTH)
    const x = event.detail.clientX - rect.left
    this.editorWidth = Math.min(Math.max(x, MIN_EDITOR_WIDTH), max)
  }

  private _onSideSplitterMove(event: CustomEvent<{ clientY: number }>): void {
    const rect = this.sideEl.getBoundingClientRect()
    const available = rect.height - SPLITTER_SIZE
    const max = Math.max(MIN_VIEWER_HEIGHT, available - MIN_OUTPUT_HEIGHT)
    const y = event.detail.clientY - rect.top
    this.viewerHeight = Math.min(Math.max(y, MIN_VIEWER_HEIGHT), max)
  }

  private _onPalettePick(event: CustomEvent<{ type: string }>): void {
    void this.nodeEditor.addNodeAtCenter(event.detail.type)
  }

  private _onProjectNameChange(event: Event): void {
    const value = (event.target as HTMLInputElement).value
    this.projectMetadata = { ...this.projectMetadata, name: value }
    this.hasExplicitName = value.trim().length > 0
    this.dirty = true
  }

  /**
   * Returns the current project name, prompting the user for one first
   * if they have never explicitly set it (AGENTS.md: a meaningful name
   * is required before the first explicit Save/Save As/export). Returns
   * `null` if the user cancels/enters nothing, in which case the calling
   * Save/Save As action must not proceed.
   */
  private _ensureProjectName(): string | null {
    if (this.hasExplicitName) return this.projectMetadata.name

    const entered = window.prompt('Name this project before saving:', this.projectMetadata.name)
    const trimmed = entered?.trim()
    if (!trimmed) return null

    this.projectMetadata = { ...this.projectMetadata, name: trimmed }
    this.hasExplicitName = true
    return trimmed
  }

  private _buildProject(instance: SCADletEditor): ScadletProjectV1 {
    return serializeProject({
      editor: instance.editor,
      metadata: this.projectMetadata,
      getNodePosition: (id) => instance.area.nodeViews.get(id)?.position ?? { x: 0, y: 0 },
      isPinned: (id) => instance.isPinned(id),
      viewport: instance.area.area.transform,
      viewerCamera: this.viewer.getCameraState(),
    })
  }

  private async _open(): Promise<void> {
    const instance = await this.nodeEditor.whenReady()

    let project: ScadletProjectV1 | null
    try {
      project = await this.fileService.open()
    } catch (error) {
      this.renderError = error instanceof Error ? error.message : String(error)
      return
    }
    if (!project) return // User cancelled - existing project is untouched.

    // Restoring necessarily performs node/connection/position/pin/
    // viewport operations that would otherwise look exactly like user
    // edits - suspended so the freshly loaded project starts clean
    // regardless of how many individual dirty-triggering signals fire
    // during restore.
    await instance.withDirtyTrackingSuspended(() =>
      restoreProject(project, {
        editor: instance.editor,
        creationContext: instance.creationContext,
        setNodePosition: async (id, position) => {
          await instance.area.translate(id, position)
        },
        setPinned: (id, pinned) => instance.setPinned(id, pinned),
        setViewport: async ({ x, y, k }) => {
          await instance.area.area.translate(x, y)
          await instance.area.area.zoom(k, 0, 0)
        },
        setViewerCamera: (camera) => this.viewer.setCameraState(camera),
      }),
    )

    this.projectMetadata = project.metadata
    this.hasExplicitName = true
    this.dirty = false
    this.renderError = null
    // The old graph's rendered output/preview no longer describes the newly restored graph.
    this.scadSource = ''
    this.exportSource = ''
    this.stl = null
    this.viewer.clear()
  }

  private async _saveAs(): Promise<void> {
    const instance = await this.nodeEditor.whenReady()
    const name = this._ensureProjectName()
    if (!name) return

    try {
      const project = this._buildProject(instance)
      const saved = await this.fileService.saveAs(project, toScadletFilename(name))
      if (!saved) return // User cancelled the save picker - dirty state and metadata are unchanged.
      this.projectMetadata = project.metadata
      this.dirty = false
    } catch (error) {
      this.renderError = error instanceof Error ? error.message : String(error)
    }
  }

  private async _save(): Promise<void> {
    const instance = await this.nodeEditor.whenReady()
    const name = this._ensureProjectName()
    if (!name) return

    try {
      const project = this._buildProject(instance)
      const saved = await this.fileService.save(project, toScadletFilename(name))
      if (!saved) return // User cancelled the save picker - dirty state and metadata are unchanged.
      this.projectMetadata = project.metadata
      this.dirty = false
    } catch (error) {
      this.renderError = error instanceof Error ? error.message : String(error)
    }
  }

  private readonly _onKeyDown = (event: KeyboardEvent): void => {
    if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 's') return
    event.preventDefault()
    void this._save()
  }

  private async _render() {
    if (this.rendering) return

    const tStart = performance.now()
    // Render always evaluates the current graph first, so it's the one
    // action that keeps the SCAD output, the `.scad` download, and the
    // WASM render in sync with each other - there is no separate
    // "Evaluate" action/code path to fall out of sync with this one.
    //
    // The full-model evaluation always happens and is what ".scad" export
    // uses, regardless of Inspect Node state. When a node is being
    // inspected (Inspect Node - see `editor/inspect.ts`), the preview
    // actually rendered/displayed instead evaluates just that node's
    // subtree, reusing the exact same evaluation path with an explicit
    // root rather than a second evaluator (`evaluateOpenSCAD`'s optional
    // `rootNodeId`). With nothing inspected the two are identical, so
    // normal Render behaves exactly as it did before Inspect Node existed.
    const fullSource = await this.nodeEditor.evaluate()
    this.exportSource = fullSource

    const inspectedNodeId = this.nodeEditor.getInspectedNodeId()
    const previewSource = inspectedNodeId ? await this.nodeEditor.evaluate(inspectedNodeId) : fullSource
    this.scadSource = previewSource
    const tEval = performance.now()

    if (!previewSource.trim()) {
      this.renderError = 'Nothing to render - add at least one node.'
      return
    }

    this.rendering = true
    this.renderError = null
    try {
      const stl = await this.renderController.render(previewSource)
      const tRendered = performance.now()
      this.stl = stl
      this.viewer.showSTL(stl)
      const tViewer = performance.now()
      console.log(
        `[scadlet-app] eval=${(tEval - tStart).toFixed(1)}ms ` +
          `render=${(tRendered - tEval).toFixed(1)}ms ` +
          `viewer=${(tViewer - tRendered).toFixed(1)}ms ` +
          `total=${(tViewer - tStart).toFixed(1)}ms`,
      )
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
    if (!this.exportSource) return
    triggerDownload(scadBlob(this.exportSource), 'scadlet-model.scad')
  }

  private _downloadStl() {
    if (!this.stl) return
    triggerDownload(stlBlob(this.stl), 'scadlet-model.stl')
  }

  disconnectedCallback() {
    super.disconnectedCallback()
    window.removeEventListener('keydown', this._onKeyDown)
    this.unsubscribeDirty?.()
    this.unsubscribeCameraDirty?.()
    this.renderController.destroy()
    this.mainResizeObserver?.disconnect()
    this.sideResizeObserver?.disconnect()
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'scadlet-app': ScadletApp
  }
}


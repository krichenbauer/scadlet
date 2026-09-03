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
import { ActiveProjectSession, createBrowserActiveProjectSession, resolveStartupProject } from './persistence/active-project'
import { AutosaveController, type AutosaveStatus } from './persistence/autosave'
import { toScadletFilename } from './persistence/filename'
import { createBrowserFileSystemCapability, pickFileWithInput, ProjectFileService } from './persistence/file-service'
import {
  IndexedDBLocalProjectStore,
  type LocalProjectStore,
  type ProjectSummary,
  type StoredProject,
} from './persistence/local-project-store'
import { createEmptyProject, UNTITLED_PROJECT_NAME, type ScadletProjectMetadata, type ScadletProjectV1 } from './persistence/project'
import { LocalProjectEvents, type LocalProjectEvent } from './persistence/project-events'
import { restoreProject } from './persistence/restore'
import { serializeProject } from './persistence/serialize'
import { RenderController } from './render/render-controller'
import { ExecutionGeneration } from './render/execution-generation'
import { scadBlob, stlBlob, triggerDownload } from './render/download'
import { t } from './i18n/translate'

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

    .github-link {
      color: inherit;
      font-size: 12px;
      opacity: 0.75;
      text-decoration: none;
    }

    .github-link:hover,
    .github-link:focus-visible {
      opacity: 1;
      text-decoration: underline;
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

    .project-picker {
      max-width: 180px;
      font: inherit;
      padding: 4px 6px;
    }

    .persistence-status {
      margin: 0;
      padding: 6px 10px;
      background: #453b1f;
      color: #ffe39a;
      font-size: 12px;
      border-top: 1px solid #75652f;
    }

    .persistence-actions {
      display: inline-flex;
      gap: 6px;
      margin-left: 8px;
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
  private readonly executionGeneration = new ExecutionGeneration()
  private activeExecution: 'render' | 'inspect' | null = null
  private mainResizeObserver?: ResizeObserver
  private sideResizeObserver?: ResizeObserver

  private readonly fileService = new ProjectFileService({
    capability: createBrowserFileSystemCapability(),
    pickFileFallback: pickFileWithInput,
    downloadFallback: (content, filename) =>
      triggerDownload(new Blob([content], { type: 'application/json' }), filename),
  })
  private unsubscribeDirty?: () => void
  private unsubscribeSemantic?: () => void
  private unsubscribeInspect?: () => void
  private unsubscribeCameraDirty?: () => void
  private localStore: LocalProjectStore | null = null
  private activeProjectSession: ActiveProjectSession | null = null
  private localEvents: LocalProjectEvents | null = null
  private unsubscribeLocalEvents?: () => void
  private autosave?: AutosaveController
  private editorInstance?: SCADletEditor
  private activeRevision = 0
  /** Whether the user has ever explicitly set a project name (see `_ensureProjectName`) - distinct from the name merely still being the placeholder string, since a project could legitimately be named that on purpose. */
  private hasExplicitName = false

  @state()
  private projectMetadata: ScadletProjectMetadata = { name: UNTITLED_PROJECT_NAME }

  /** Unsaved-changes indicator. Covers node/connection add/remove/move, pin state, and project-name edits (see `editor/editor.ts`'s `onDirty` for what it does and does not cover). */
  @state()
  private dirty = false

  @state()
  private localProjects: ProjectSummary[] = []

  @state()
  private activeProjectId: string | null = null

  @state()
  private localInitializing = true

  @state()
  private autosaveStatus: AutosaveStatus = 'idle'

  @state()
  private persistenceMessage: string | null = null

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
        <a
          class="github-link"
          href="https://github.com/krichenbauer/scadlet"
          target="_blank"
          rel="noopener noreferrer"
          aria-label=${t('toolbar.github')}
        >GitHub</a>
        <button type="button" @click=${this._newProject} ?disabled=${this.localInitializing || !this.localStore}>
          ${t('toolbar.new')}
        </button>
        <select
          class="project-picker"
          aria-label=${t('toolbar.localProject')}
          .value=${this.activeProjectId ?? ''}
          @change=${this._onLocalProjectSelected}
          ?disabled=${this.localInitializing || !this.localStore || this.localProjects.length === 0}
        >
          ${this.localProjects.map(
            (project) => html`<option value=${project.id} ?selected=${project.id === this.activeProjectId}>
              ${project.name}
            </option>`,
          )}
        </select>
        <button
          type="button"
          @click=${this._deleteCurrentProject}
          ?disabled=${this.localInitializing || !this.localStore || !this.activeProjectId}
        >
          ${t('toolbar.delete')}
        </button>
        <input
          type="text"
          class="project-name"
          .value=${this.projectMetadata.name}
          @change=${this._onProjectNameChange}
          ?disabled=${this.localInitializing}
          aria-label=${t('toolbar.projectName')}
        />
        ${this.dirty
          ? html`<span class="dirty-indicator" title=${t('toolbar.autosavePending')}>●</span>`
          : nothing}
        <span class="toolbar-gap"></span>
        <button type="button" @click=${this._open} ?disabled=${this.localInitializing}>${t('toolbar.open')}</button>
        <button type="button" @click=${this._save} ?disabled=${this.localInitializing}>${t('toolbar.save')}</button>
        <button type="button" @click=${this._saveAs} ?disabled=${this.localInitializing}>${t('toolbar.saveAs')}</button>
        <button type="button" @click=${this._render} ?disabled=${this.localInitializing}>
          ${this.rendering ? t('toolbar.rendering') : t('toolbar.render')}
        </button>
        <button type="button" @click=${this._stop} ?disabled=${!this.rendering}>${t('toolbar.stop')}</button>
        <button type="button" @click=${this._downloadScad} ?disabled=${!this.exportSource}>
          ${t('toolbar.downloadScad')}
        </button>
        <button type="button" @click=${this._downloadStl} ?disabled=${!this.stl}>${t('toolbar.downloadStl')}</button>
      </header>
      <div class="workspace">
        <node-palette .inert=${this.localInitializing} @node-palette-pick=${this._onPalettePick}></node-palette>
        <main style=${styleMap({ '--editor-width': this.editorWidth ? `${this.editorWidth}px` : undefined })}>
          <node-editor .inert=${this.localInitializing}></node-editor>
          <layout-splitter orientation="vertical" @splitter-move=${this._onMainSplitterMove}></layout-splitter>
          <div
            class="side"
            style=${styleMap({ '--viewer-height': this.viewerHeight ? `${this.viewerHeight}px` : undefined })}
          >
            <geometry-viewer></geometry-viewer>
            <layout-splitter orientation="horizontal" @splitter-move=${this._onSideSplitterMove}></layout-splitter>
            <div class="bottom-panel">
              <pre class="scad-output">${this.scadSource || `// ${t('toolbar.renderHint')}`}</pre>
              ${this.persistenceMessage
                ? html`<p class="persistence-status">
                    ${this.persistenceMessage}
                    ${this.autosaveStatus === 'conflict'
                      ? html`<span class="persistence-actions">
                          <button type="button" @click=${this._reloadConflictedProject}>${t('toolbar.reloadStored')}</button>
                          <button type="button" @click=${this._saveConflictAsCopy}>${t('toolbar.saveAsNew')}</button>
                        </span>`
                      : nothing}
                  </p>`
                : nothing}
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

    void this._initializeLocalPersistence()
  }

  private async _initializeLocalPersistence(): Promise<void> {
    const instance = await this.nodeEditor.whenReady()
    await this.viewer.updateComplete
    this.editorInstance = instance

    try {
      const store = new IndexedDBLocalProjectStore()
      const session = createBrowserActiveProjectSession()
      const stored = await resolveStartupProject(store, session)

      this.localStore = store
      this.activeProjectSession = session
      await this._applyStoredProject(stored, false)

      try {
        this.localEvents = new LocalProjectEvents()
        this.unsubscribeLocalEvents = this.localEvents.subscribe((event) => this._handleLocalProjectEvent(event))
      } catch {
        // Cross-tab notification is optional. IndexedDB's atomic
        // revision check still prevents stale writes without it.
        this.localEvents = null
      }
      await this._refreshProjectList()
      void this._requestPersistentStorageOnce()
    } catch (error) {
      // IndexedDB/session storage may be unavailable (privacy mode,
      // policy, quota, corruption). The existing file Open/Save path is
      // intentionally still fully usable in this degraded mode.
      this.localStore = null
      this.activeProjectSession = null
      this.activeProjectId = null
      this.activeRevision = 0
      this.persistenceMessage = `Local project storage is unavailable. You can still use Open and Save: ${this._errorMessage(error)}`
    } finally {
      this.unsubscribeDirty = instance.onDirty(() => this._markDirty())
      this.unsubscribeSemantic = instance.onSemanticChange(() => this._invalidateStaleInspect())
      this.unsubscribeInspect = instance.onInspect((nodeId) => void this._inspect(nodeId))
      this.unsubscribeCameraDirty = this.viewer.onCameraChange(() => this._markDirty())
      this.localInitializing = false
    }
  }

  private _enableAutosave(instance: SCADletEditor): void {
    this.autosave?.destroy()
    this.autosave = new AutosaveController({
      debounceMs: 750,
      capture: () => this._buildProject(instance),
      save: async (project) => {
        if (!this.localStore || !this.activeProjectId) throw new Error('No active local project.')
        return this.localStore.saveProject(this.activeProjectId, this.activeRevision, project)
      },
      onPersisted: (stored, isCurrentGeneration) => {
        this.activeRevision = stored.revision
        if (isCurrentGeneration) this.projectMetadata = stored.project.metadata
        this.localEvents?.publish({ type: 'project-saved', projectId: stored.id, revision: stored.revision })
        void this._refreshProjectList()
        void this._requestPersistentStorageOnce()
      },
      onStateChange: (state) => {
        this.dirty = state.dirty
        this.autosaveStatus = state.status
        this.persistenceMessage = state.message
      },
    })
  }

  private _markDirty(): void {
    if (this.autosave) {
      this.autosave.markDirty()
      return
    }
    // Degraded file-only mode retains the original unsaved-change
    // signal. A successful explicit file save clears it below.
    this.dirty = true
  }

  private async _refreshProjectList(): Promise<void> {
    if (!this.localStore) return
    try {
      this.localProjects = await this.localStore.listProjects()
    } catch (error) {
      this.persistenceMessage = `Could not read the local project list: ${this._errorMessage(error)}`
    }
  }

  private async _applyStoredProject(stored: StoredProject, clearFileHandle = true): Promise<void> {
    if (!this.editorInstance) throw new Error('The node editor is not ready.')
    await this._restoreProject(stored.project)
    this.activeProjectId = stored.id
    this.activeRevision = stored.revision
    this.activeProjectSession?.set(stored.id)
    this.projectMetadata = stored.project.metadata
    this.hasExplicitName = stored.project.metadata.name !== UNTITLED_PROJECT_NAME
    if (!this.autosave && this.localStore) this._enableAutosave(this.editorInstance)
    else this.autosave?.resetClean()
    this.dirty = false
    this.autosaveStatus = 'idle'
    this.persistenceMessage = null
    if (clearFileHandle) this.fileService.clearHandle()
    this._clearRenderedOutput()
  }

  private async _restoreProject(project: ScadletProjectV1): Promise<void> {
    const instance = this.editorInstance ?? (await this.nodeEditor.whenReady())
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
  }

  private _clearRenderedOutput(): void {
    this.renderError = null
    this.scadSource = ''
    this.exportSource = ''
    this.stl = null
    this.viewer.clear()
  }

  private async _canLeaveCurrentProject(): Promise<boolean> {
    if (!this.autosave) return !this.dirty || window.confirm('Discard changes that have not been saved to a file?')
    const saved = await this.autosave.flush()
    if (!saved) {
      this.persistenceMessage ??= 'Could not autosave this project, so SCADlet did not switch projects.'
    }
    return saved
  }

  private readonly _onLocalProjectSelected = (event: Event): void => {
    const id = (event.target as HTMLSelectElement).value
    if (!id || id === this.activeProjectId) return
    void this._switchLocalProject(id)
  }

  private async _switchLocalProject(id: string): Promise<void> {
    if (!this.localStore || !(await this._canLeaveCurrentProject())) {
      this.requestUpdate()
      return
    }
    try {
      const stored = await this.localStore.getProject(id)
      if (!stored) throw new Error('That local project no longer exists.')
      await this._applyStoredProject(stored)
      await this._refreshProjectList()
    } catch (error) {
      this.persistenceMessage = `Could not open the local project: ${this._errorMessage(error)}`
      this.requestUpdate()
    }
  }

  private readonly _newProject = (): void => {
    void this._createNewProject()
  }

  private async _createNewProject(): Promise<void> {
    if (!this.localStore || !(await this._canLeaveCurrentProject())) return
    try {
      const stored = await this.localStore.createProject(createEmptyProject())
      await this._applyStoredProject(stored)
      this.localEvents?.publish({ type: 'project-created', projectId: stored.id, revision: stored.revision })
      await this._refreshProjectList()
    } catch (error) {
      this.persistenceMessage = `Could not create a local project: ${this._errorMessage(error)}`
    }
  }

  private readonly _deleteCurrentProject = (): void => {
    void this._deleteActiveProject()
  }

  private async _deleteActiveProject(): Promise<void> {
    if (!this.localStore || !this.activeProjectId) return
    if (!window.confirm(`Delete "${this.projectMetadata.name}" from this browser? Exported files are not affected.`)) return
    if (!(await this._canLeaveCurrentProject())) return

    const deletedId = this.activeProjectId
    try {
      await this.localStore.deleteProject(deletedId)
      this.activeProjectSession?.clear()
      this.localEvents?.publish({ type: 'project-deleted', projectId: deletedId })
      const replacement = await resolveStartupProject(this.localStore, this.activeProjectSession!)
      await this._applyStoredProject(replacement)
      await this._refreshProjectList()
    } catch (error) {
      this.persistenceMessage = `Could not delete the local project: ${this._errorMessage(error)}`
    }
  }

  private _handleLocalProjectEvent(event: LocalProjectEvent): void {
    void this._refreshProjectList()
    if (event.projectId !== this.activeProjectId) return

    if (event.type === 'project-deleted') {
      this.autosave?.markConflict('This project was deleted in another SCADlet tab. Your current work is still open here.')
      return
    }
    if (event.revision > this.activeRevision) this.autosave?.markConflict()
  }

  private readonly _reloadConflictedProject = (): void => {
    void this._reloadStoredProject()
  }

  private async _reloadStoredProject(): Promise<void> {
    if (!this.localStore || !this.activeProjectId) return
    if (this.dirty && !window.confirm('Reload the stored version and discard this tab\'s unsaved changes?')) return
    try {
      const stored = await this.localStore.getProject(this.activeProjectId)
      if (!stored) throw new Error('The local project was deleted.')
      await this._applyStoredProject(stored, false)
      await this._refreshProjectList()
    } catch (error) {
      this.persistenceMessage = `Could not reload the stored project: ${this._errorMessage(error)}`
    }
  }

  private readonly _saveConflictAsCopy = (): void => {
    void this._saveCurrentAsLocalCopy()
  }

  private async _saveCurrentAsLocalCopy(): Promise<void> {
    if (!this.localStore || !this.editorInstance) return
    try {
      const stored = await this.localStore.createProject(this._buildProject(this.editorInstance))
      this.activeProjectId = stored.id
      this.activeRevision = stored.revision
      this.activeProjectSession?.set(stored.id)
      this.projectMetadata = stored.project.metadata
      this.fileService.clearHandle()
      this.autosave?.resetClean()
      this.localEvents?.publish({ type: 'project-created', projectId: stored.id, revision: stored.revision })
      await this._refreshProjectList()
    } catch (error) {
      this.persistenceMessage = `Could not save a local copy: ${this._errorMessage(error)}`
    }
  }

  private async _requestPersistentStorageOnce(): Promise<void> {
    const storage = navigator.storage
    if (!storage?.persist) return
    const marker = 'scadlet.persistRequested'
    try {
      if (window.sessionStorage.getItem(marker)) return
      window.sessionStorage.setItem(marker, '1')
      await storage.persist()
    } catch {
      // Optional eviction protection only. Denial/unavailability never
      // changes correctness or interrupts normal project persistence.
    }
  }

  private _errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
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
    const input = event.target as HTMLInputElement
    const trimmed = input.value.trim()
    const name = trimmed || UNTITLED_PROJECT_NAME
    input.value = name
    this.projectMetadata = { ...this.projectMetadata, name }
    this.hasExplicitName = trimmed.length > 0
    this._markDirty()
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
    this._markDirty()
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
    if (!(await this._canLeaveCurrentProject())) return

    let project: ScadletProjectV1 | null
    try {
      project = await this.fileService.open()
    } catch (error) {
      this.renderError = error instanceof Error ? error.message : String(error)
      return
    }
    if (!project) return // User cancelled - existing project is untouched.

    if (this.localStore) {
      try {
        // Every external file import gets a new local identity. A
        // same-named project in the library is never overwritten.
        const stored = await this.localStore.createProject(project)
        await this._applyStoredProject(stored, false)
        this.hasExplicitName = true
        this.localEvents?.publish({ type: 'project-created', projectId: stored.id, revision: stored.revision })
        await this._refreshProjectList()
        return
      } catch (error) {
        this.persistenceMessage = `The file opened, but it could not be added to local storage: ${this._errorMessage(error)}`
      }
    }

    // Degraded file-only mode: opening remains usable even if IndexedDB
    // is unavailable or the import write failed.
    await this._restoreProject(project)
    this.autosave?.destroy()
    this.autosave = undefined
    this.activeProjectId = null
    this.activeRevision = 0
    this.activeProjectSession?.clear()
    this.projectMetadata = project.metadata
    this.hasExplicitName = true
    this.dirty = false
    this._clearRenderedOutput()
  }

  private async _saveAs(): Promise<void> {
    const instance = await this.nodeEditor.whenReady()
    const name = this._ensureProjectName()
    if (!name) return

    try {
      const project = this._buildProject(instance)
      const saved = await this.fileService.saveAs(project, toScadletFilename(name))
      if (!saved) return // User cancelled the save picker - dirty state and metadata are unchanged.
      // File export is independent from local autosave. In normal mode
      // it does not redefine local dirty state; in degraded file-only
      // mode it remains the durable-save boundary.
      if (!this.autosave) {
        this.projectMetadata = project.metadata
        this.dirty = false
      }
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
      if (!this.autosave) {
        this.projectMetadata = project.metadata
        this.dirty = false
      }
    } catch (error) {
      this.renderError = error instanceof Error ? error.message : String(error)
    }
  }

  private readonly _onKeyDown = (event: KeyboardEvent): void => {
    if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 's') return
    event.preventDefault()
    void this._save()
  }

  private _beginExecution(kind: 'render' | 'inspect'): number {
    const generation = this.executionGeneration.begin()
    if (this.renderController.isRendering) this.renderController.stop()
    this.activeExecution = kind
    this.rendering = true
    this.renderError = null
    return generation
  }

  private _finishExecution(generation: number): void {
    if (!this.executionGeneration.isCurrent(generation)) return
    this.activeExecution = null
    this.rendering = false
  }

  /** A semantic edit makes an in-flight Inspect obsolete. The existing last
   * successful geometry preview stays in the viewer; only its pending worker
   * request is cancelled, and no automatic re-evaluation is started. */
  private _invalidateStaleInspect(): void {
    if (this.activeExecution !== 'inspect') return
    this.executionGeneration.invalidate()
    this.activeExecution = null
    this.rendering = false
    this.renderController.stop()
  }

  private async _render() {
    const generation = this._beginExecution('render')
    const tStart = performance.now()
    try {
      // Toolbar Render always evaluates the complete project. A temporary
      // Inspect root never changes normal preview or `.scad` export scope.
      const source = await this.nodeEditor.evaluate()
      if (!this.executionGeneration.isCurrent(generation)) return
      this.exportSource = source
      this.scadSource = source
      if (!source.trim()) {
        this.renderError = 'Nothing to render - add at least one node.'
        return
      }
      const stl = await this.renderController.render(source)
      if (!this.executionGeneration.isCurrent(generation)) return
      this.stl = stl
      this.viewer.showSTL(stl)
      console.log(`[scadlet-app] render total=${(performance.now() - tStart).toFixed(1)}ms`)
    } catch (error) {
      if (!this.executionGeneration.isCurrent(generation)) return
      const message = error instanceof Error ? error.message : String(error)
      if (message !== 'Render stopped') this.renderError = message
    } finally {
      this._finishExecution(generation)
    }
  }

  /** Executes exactly one OpenSCAD-backed evaluation for the node selected
   * by an Inspect double-click. It never starts live/background evaluation. */
  private async _inspect(nodeId: string): Promise<void> {
    const generation = this._beginExecution('inspect')
    try {
      const inspected = await this.nodeEditor.evaluateInspect(nodeId)
      if (!this.executionGeneration.isCurrent(generation) || inspected.kind === 'missing') return

      // Retain a complete `.scad` export while rendering/evaluating only the
      // temporary Inspect root. This is evaluation only, never a second render.
      const fullSource = await this.nodeEditor.evaluate()
      if (!this.executionGeneration.isCurrent(generation)) return
      this.exportSource = fullSource

      if (inspected.kind === 'value') {
        const source = `echo("__SCADLET_VALUE__:", ${inspected.expression});`
        this.scadSource = source
        const value = await this.renderController.inspectValue(source)
        if (!this.executionGeneration.isCurrent(generation)) return
        this.editorInstance?.setInspectedValueResult(nodeId, value)
        return
      }

      if (!inspected.source.trim()) {
        this.renderError = 'Nothing to render - add at least one node.'
        return
      }
      this.scadSource = inspected.source
      const stl = await this.renderController.render(inspected.source)
      if (!this.executionGeneration.isCurrent(generation)) return
      this.stl = stl
      this.viewer.showSTL(stl)
    } catch (error) {
      if (!this.executionGeneration.isCurrent(generation)) return
      const message = error instanceof Error ? error.message : String(error)
      if (message !== 'Render stopped') this.renderError = message
    } finally {
      this._finishExecution(generation)
    }
  }

  private _stop() {
    this.executionGeneration.invalidate()
    this.activeExecution = null
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
    this.unsubscribeSemantic?.()
    this.unsubscribeInspect?.()
    this.unsubscribeCameraDirty?.()
    this.unsubscribeLocalEvents?.()
    this.localEvents?.close()
    this.autosave?.destroy()
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

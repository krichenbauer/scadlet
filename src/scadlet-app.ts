import { LitElement, css, html, nothing } from 'lit'
import { customElement, query, state } from 'lit/decorators.js'
import { styleMap } from 'lit/directives/style-map.js'

import './components/node-editor'
import './components/geometry-viewer'
import './components/splitter'
import './components/node-palette'
import { compactIcon } from './components/icons'
import type { NodeEditorElement } from './components/node-editor'
import type { GeometryViewer } from './components/geometry-viewer'
import type { SCADletEditor } from './editor/editor'
import { ActiveProjectSession, createBrowserActiveProjectSession, resolveStartupProject, resolveStartupProjectWithOrigin, StartupProjectLoadError } from './persistence/active-project'
import { AutosaveController, type AutosaveStatus } from './persistence/autosave'
import { sanitizeFilename, toScadletFilename } from './persistence/filename'
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
import { AUTOMATIC_RENDER_TIMEOUT_MS, RenderController, RenderTimeoutError } from './render/render-controller'
import { ExecutionGeneration } from './render/execution-generation'
import { LiveRenderScheduler } from './render/live-render-scheduler'
import { PreviewRenderCache } from './render/preview-cache'
import { GEOMETRY_RENDER_OPTIONS } from './render/render-options'
import { scadBlob, stlBlob, triggerDownload } from './render/download'
import { t } from './i18n/translate'
import type { ModuleDefinition } from './editor/definitions'

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
      background: #202020;
      color: #eee;
      color-scheme: dark;
      user-select: none;
      -webkit-user-select: none;
    }

    header {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 12px;
      border-bottom: 1px solid #444;
      background: #202020;
    }

    header h1 {
      font-size: 14px;
      font-weight: 600;
      margin: 0;
    }

    .github-link {
      display: grid;
      width: 30px;
      height: 30px;
      place-items: center;
      color: inherit;
      opacity: 0.75;
      text-decoration: none;
    }

    .github-link:hover,
    .github-link:focus-visible {
      opacity: 1;
    }
    .github-link svg { width: 17px; height: 17px; fill: currentcolor; }

    .header-spacer { flex: 1; }

    .menu-anchor { position: relative; }
    .compact-menu-button { min-height: 30px; padding: 4px 8px; }
    .project-menu-button { width: 28px; min-width: 28px; padding: 0; }
    .menu-popover {
      position: absolute;
      z-index: 5;
      top: calc(100% + 6px);
      left: 0;
      width: min(340px, calc(100vw - 24px));
      padding: 8px;
      border: 1px solid #666;
      border-radius: 6px;
      background: #292929;
      box-shadow: 0 8px 24px rgb(0 0 0 / 0.45);
    }
    .file-menu { width: 190px; }
    .project-menu-actions { display: flex; gap: 6px; align-items: center; }
    .project-menu-actions button:first-child { margin-right: auto; }
    .icon-button {
      display: grid; width: 32px; min-width: 32px; height: 32px; place-items: center; padding: 0;
    }
    .icon-button svg, .sort-icon svg { width: 17px; height: 17px; fill: none; stroke: currentcolor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
    .project-menu-sort { display: flex; align-items: center; gap: 6px; margin: 8px 0; font-size: 12px; }
    .sort-icon { display: grid; width: 26px; height: 27px; place-items: center; color: #b8d8eb; }
    .project-menu-sort select { min-height: 27px; padding: 3px; border: 1px solid #666; border-radius: 4px; background: #242424; color: #eee; }
    .project-menu-list { display: grid; gap: 2px; max-height: min(50vh, 360px); overflow: auto; border-top: 1px solid #555; padding-top: 7px; }
    .project-row, .file-action {
      width: 100%; min-height: 32px; padding: 5px 7px; border: 1px solid transparent; border-radius: 4px;
      background: transparent; color: #eee; text-align: left; font: inherit;
    }
    .project-row:hover, .file-action:hover { background: #393939; border-color: #555; }
    .project-row--active { background: #253b49; color: #e0f3ff; }
    .active-check { display: inline-block; width: 18px; }
    .project-row-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .file-action + .file-action { margin-top: 2px; }
    .file-menu .file-action { display: block; }
    .menu-popover button:focus-visible, .menu-popover select:focus-visible { outline: 2px solid rgb(122 192 255 / 0.7); outline-offset: 1px; }

    button {
      font: inherit;
      padding: 4px 10px;
      border: 1px solid #666;
      border-radius: 4px;
      background: #2a2a2a;
      color: #eee;
      color-scheme: dark;
      cursor: pointer;
    }

    button:hover:not(:disabled) { background: #353535; border-color: #888; }
    button:focus-visible,
    input:focus-visible,
    select:focus-visible,
    textarea:focus-visible { outline: 2px solid rgb(122 192 255 / 0.55); outline-offset: 1px; }

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
      user-select: text;
      -webkit-user-select: text;
    }

    .project-name:hover,
    .project-name:focus {
      border-color: #666;
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

    .workspace {
      display: grid;
      grid-template-columns: 200px minmax(0, 1fr);
      min-height: 0;
      min-width: 0;
      background: #202020;
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
      background: #202020;
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
      background: #181818;
    }

    .scad-output {
      flex: 1;
      margin: 0;
      padding: 8px;
      overflow: auto;
      border-top: 1px solid #444;
      background: #181818;
      color: #eee;
      font: 12px/1.4 ui-monospace, monospace;
      white-space: pre-wrap;
      user-select: text;
      -webkit-user-select: text;
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

    .module-dialog-backdrop {
      position: fixed;
      inset: 0;
      z-index: 10;
      display: grid;
      place-items: center;
      background: rgb(0 0 0 / 0.45);
    }

    .module-dialog {
      display: grid;
      gap: 14px;
      min-width: 280px;
      padding: 18px;
      border: 1px solid #666;
      border-radius: 8px;
      background: #292929;
      color: #eee;
      box-shadow: 0 8px 30px rgb(0 0 0 / 0.5);
    }

    .module-dialog h2 { margin: 0; font-size: 16px; }
    .module-dialog label { display: grid; gap: 5px; }
    .module-dialog input {
      padding: 5px;
      border: 1px solid #666;
      border-radius: 4px;
      background: #202020;
      color: #eee;
      color-scheme: dark;
      font: inherit;
      user-select: text;
      -webkit-user-select: text;
    }
    .module-dialog-actions { display: flex; justify-content: flex-end; gap: 8px; }
    .module-error { margin: -6px 0 0; color: #ffb3b3; font-size: 12px; }
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
  private readonly previewCache = new PreviewRenderCache()
  private readonly executionGeneration = new ExecutionGeneration()
  private activeExecution: 'render' | 'inspect' | null = null
  /** The origin only affects scheduling/cancellation policy, never project data. */
  private activeRenderOrigin: 'manual' | 'live' | null = null
  private readonly liveScheduler = new LiveRenderScheduler({
    onDue: (revision) => { void this._renderLive(revision) },
  })
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
  private unsubscribeInspectEnd?: () => void
  private unsubscribeCameraDirty?: () => void
  private unsubscribeDefinitions?: () => void
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

  /** Unsaved-changes indicator. Covers node/connection add/remove/move, collapse state, and project-name edits (see `editor/editor.ts`'s `onDirty` for what it does and does not cover). */
  @state()
  private dirty = false

  @state()
  private localProjects: ProjectSummary[] = []

  @state()
  private activeProjectId: string | null = null

  @state()
  private projectsMenuOpen = false

  @state()
  private fileMenuOpen = false

  @state()
  private projectSort: 'alphabetical' | 'recent' = 'recent'

  /** A project which could not be opened remains a library record, but is
   * never treated as the currently reconstructed editor state. */
  @state()
  private failedProject: ProjectSummary | null = null

  @state()
  private localInitializing = true

  @state()
  private autosaveStatus: AutosaveStatus = 'idle'

  @state()
  private persistenceMessage: string | null = null

  @state()
  private scadSource = ''

  @state()
  private rendering = false

  @state()
  private showRenderStop = false

  /** Live is intentionally app-session UI state, never project data. */
  @state()
  private live = true

  private renderStopTimer?: ReturnType<typeof setTimeout>

  @state()
  private renderError: string | null = null

  /** Valid empty Geometry is preview state, not a compiler/render error. */
  @state()
  private renderInfo: string | null = null

  @state()
  private stl: ArrayBuffer | null = null

  @state()
  private moduleDefinitions: readonly ModuleDefinition[] = []

  @state()
  private moduleDialogOpen = false

  @state()
  private moduleName = ''

  @state()
  private moduleError: string | null = null

  @state()
  private editingModuleId: string | null = null

  @state()
  private functionDefinitions: readonly ModuleDefinition[] = []

  @state()
  private functionDialogOpen = false

  @state()
  private functionName = ''

  @state()
  private functionError: string | null = null

  @state()
  private editingFunctionId: string | null = null

  /** Width, in pixels, of the node-editor pane. 0 means "not measured yet". */
  @state()
  private editorWidth = 0

  /** Height, in pixels, of the geometry-viewer pane. 0 means "not measured yet". */
  @state()
  private viewerHeight = 0

  render() {
    return html`
      <header>
        <div class="menu-anchor">
          <button class="compact-menu-button" type="button" aria-expanded=${String(this.fileMenuOpen)} @click=${this._toggleFileMenu}>${t('toolbar.file')} ⌄</button>
          ${this.fileMenuOpen ? this._filePopover() : nothing}
        </div>
        <input
          type="text"
          class="project-name"
          .value=${this.projectMetadata.name}
          @blur=${this._commitProjectName}
          @keydown=${this._onProjectNameKeydown}
          ?disabled=${this.localInitializing}
          aria-label=${t('toolbar.projectName')}
        />
        <div class="menu-anchor">
          <button class="compact-menu-button project-menu-button" type="button" aria-label=${t('toolbar.projects')} aria-expanded=${String(this.projectsMenuOpen)} @click=${this._toggleProjectsMenu}>⌄</button>
          ${this.projectsMenuOpen ? this._projectsPopover() : nothing}
        </div>
        <span class="header-spacer"></span>
        <h1>SCADlet</h1>
        <a class="github-link" href="https://github.com/krichenbauer/scadlet" target="_blank" rel="noopener noreferrer" aria-label=${t('toolbar.github')} title=${t('toolbar.github')}>
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 0C3.58 0 0 3.64 0 8.13c0 3.59 2.29 6.64 5.47 7.71.4.08.55-.18.55-.4 0-.2-.01-.86-.01-1.56-2.01.38-2.53-.5-2.69-.96-.09-.24-.47-.96-.8-1.15-.27-.15-.65-.53-.01-.54.6-.01 1.03.56 1.17.79.69 1.18 1.8.85 2.24.65.07-.51.27-.85.49-1.04-1.78-.2-3.64-.91-3.64-4.04 0-.89.31-1.62.82-2.19-.08-.2-.36-1.04.08-2.17 0 0 .67-.22 2.2.84A7.46 7.46 0 0 1 8 4.83c.68 0 1.36.09 2 .27 1.53-1.06 2.2-.84 2.2-.84.44 1.13.16 1.97.08 2.17.51.57.82 1.29.82 2.19 0 3.14-1.87 3.84-3.65 4.04.29.25.54.72.54 1.46 0 1.05-.01 1.9-.01 2.17 0 .22.15.48.55.4A8.03 8.03 0 0 0 16 8.13C16 3.64 12.42 0 8 0Z" /></svg>
        </a>
      </header>
      <div class="workspace">
        <node-palette
          .inert=${this.localInitializing}
          .modules=${this.moduleDefinitions}
          .functions=${this.functionDefinitions.map((definition) => ({ id: definition.id, name: definition.name, callable: definition.resultType !== undefined }))}
          @new-module=${this._openModuleDialog}
          @focus-module=${this._focusModule}
          @edit-module=${this._openRenameModuleDialog}
          @delete-module=${this._deleteModule}
          @new-function=${this._openFunctionDialog}
          @focus-function=${this._focusFunction}
          @edit-function=${this._openRenameFunctionDialog}
          @delete-function=${this._deleteFunction}
        ></node-palette>
        <main style=${styleMap({ '--editor-width': this.editorWidth ? `${this.editorWidth}px` : undefined })}>
          <node-editor
            .inert=${this.localInitializing}
            @edit-module=${this._openRenameModuleDialog}
            @delete-module=${this._deleteModule}
            @edit-function=${this._openRenameFunctionDialog}
            @delete-function=${this._deleteFunction}
          ></node-editor>
          <layout-splitter orientation="vertical" @splitter-move=${this._onMainSplitterMove}></layout-splitter>
          <div
            class="side"
            style=${styleMap({ '--viewer-height': this.viewerHeight ? `${this.viewerHeight}px` : undefined })}
          >
            <geometry-viewer .status=${this.renderInfo ?? ''} .live=${this.live} .rendering=${this.rendering} .showStop=${this.showRenderStop} @live-change=${this._setLive} @manual-render=${this._render} @manual-render-stop=${this._stop}></geometry-viewer>
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
      ${this.moduleDialogOpen ? html`
        <div class="module-dialog-backdrop" @click=${this._cancelModuleDialog}>
          <form class="module-dialog" aria-label=${this.editingModuleId ? t('definition.renameModule') : t('definition.createModule')} @submit=${this._submitModule} @click=${(event: Event) => event.stopPropagation()}>
            <h2>${this.editingModuleId ? t('definition.renameModule') : t('definition.createModule')}</h2>
            <label>
              ${t('definition.moduleName')}
              <input type="text" .value=${this.moduleName} @input=${this._onModuleNameInput} autofocus />
            </label>
            ${this.moduleError ? html`<p class="module-error" role="alert">${this.moduleError}</p>` : nothing}
            <div class="module-dialog-actions">
              <button type="button" @click=${this._cancelModuleDialog}>${t('definition.cancel')}</button>
              <button type="submit">${this.editingModuleId ? t('definition.save') : t('definition.create')}</button>
            </div>
          </form>
        </div>
      ` : nothing}
      ${this.functionDialogOpen ? html`
        <div class="module-dialog-backdrop" @click=${this._cancelFunctionDialog}>
          <form class="module-dialog" aria-label=${this.editingFunctionId ? t('definition.renameFunction') : t('definition.createFunction')} @submit=${this._submitFunction} @click=${(event: Event) => event.stopPropagation()}>
            <h2>${this.editingFunctionId ? t('definition.renameFunction') : t('definition.createFunction')}</h2>
            <label>
              ${t('definition.functionName')}
              <input type="text" .value=${this.functionName} @input=${this._onFunctionNameInput} autofocus />
            </label>
            ${this.functionError ? html`<p class="module-error" role="alert">${this.functionError}</p>` : nothing}
            <div class="module-dialog-actions">
              <button type="button" @click=${this._cancelFunctionDialog}>${t('definition.cancel')}</button>
              <button type="submit">${this.editingFunctionId ? t('definition.save') : t('definition.create')}</button>
            </div>
          </form>
        </div>
      ` : nothing}
    `
  }

  private _projectsPopover() {
    const active = this.localProjects.find((project) => project.id === this.activeProjectId)
    const others = this.localProjects
      .filter((project) => project.id !== this.activeProjectId)
      .sort((a, b) => this.projectSort === 'alphabetical'
        ? a.name.localeCompare(b.name) || b.updatedAt.localeCompare(a.updatedAt)
        : b.updatedAt.localeCompare(a.updatedAt) || a.name.localeCompare(b.name))
    const ordered = active ? [active, ...others] : others
    return html`<div class="menu-popover" role="dialog" aria-label=${t('toolbar.projects')} @keydown=${this._onMenuKeydown}>
      <div class="project-menu-actions">
        <button class="icon-button" type="button" aria-label=${t('toolbar.newProjectAction')} title=${t('toolbar.newProjectAction')} @click=${this._newProject} ?disabled=${this.localInitializing || !this.localStore}>${compactIcon('plus')}</button>
        <button class="icon-button" type="button" aria-label=${t('toolbar.duplicateActiveProject')} title=${t('toolbar.duplicateActiveProject')} @click=${this._duplicateActiveProject} ?disabled=${this.localInitializing || !this.activeProjectId}>${compactIcon('copy')}</button>
        <button class="icon-button" type="button" aria-label=${t('toolbar.deleteActiveProject')} title=${t('toolbar.deleteActiveProject')} @click=${this._deleteCurrentProject} ?disabled=${this.localInitializing || (!this.activeProjectId && !this.failedProject)}>${compactIcon('trash')}</button>
      </div>
      <label class="project-menu-sort">${t('toolbar.sort')}
        <span class="sort-icon" title=${this.projectSort === 'alphabetical' ? t('toolbar.sortAlphabetical') : t('toolbar.sortRecent')} aria-hidden="true">${compactIcon(this.projectSort === 'alphabetical' ? 'sort-alpha' : 'clock')}</span>
        <select .value=${this.projectSort} @change=${this._changeProjectSort} aria-label=${t('toolbar.sort')}>
          <option value="alphabetical">${t('toolbar.sortAlphabetical')}</option>
          <option value="recent">${t('toolbar.sortRecent')}</option>
        </select>
      </label>
      <div class="project-menu-list">
        ${ordered.map((project) => html`<button type="button" class="project-row ${project.id === this.activeProjectId ? 'project-row--active' : ''}" @click=${() => this._selectProjectRow(project.id)}>
          <span class="active-check" aria-hidden="true">${project.id === this.activeProjectId ? '✓' : ''}</span><span class="project-row-name">${project.name}</span>
        </button>`)}
      </div>
    </div>`
  }

  private _filePopover() {
    return html`<div class="menu-popover file-menu" role="menu" aria-label=${t('toolbar.file')} @keydown=${this._onMenuKeydown}>
      <button type="button" class="file-action" role="menuitem" @click=${this._open}>${t('toolbar.open')}</button>
      <button type="button" class="file-action" role="menuitem" @click=${this._saveAs}>${t('toolbar.saveScadlet')}</button>
      <button type="button" class="file-action" role="menuitem" @click=${this._downloadScad}>${t('toolbar.downloadScad')}</button>
      <button type="button" class="file-action" role="menuitem" @click=${this._downloadStl}>${t('toolbar.downloadStl')}</button>
    </div>`
  }

  private readonly _toggleProjectsMenu = (): void => {
    this.projectsMenuOpen = !this.projectsMenuOpen
    if (this.projectsMenuOpen) this.fileMenuOpen = false
  }

  private readonly _toggleFileMenu = (): void => {
    this.fileMenuOpen = !this.fileMenuOpen
    if (this.fileMenuOpen) this.projectsMenuOpen = false
  }

  private readonly _changeProjectSort = (event: Event): void => {
    this.projectSort = (event.target as HTMLSelectElement).value === 'alphabetical' ? 'alphabetical' : 'recent'
  }

  private readonly _onMenuKeydown = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape') return
    event.stopPropagation()
    this.projectsMenuOpen = false
    this.fileMenuOpen = false
  }

  private readonly _selectProjectRow = (id: string): void => {
    this.projectsMenuOpen = false
    if (id !== this.activeProjectId) void this._switchLocalProject(id)
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
    this.unsubscribeDefinitions = instance.onDefinitionsChange(() => {
      this._refreshDefinitions(instance)
    })

    try {
      const store = new IndexedDBLocalProjectStore()
      const session = createBrowserActiveProjectSession()
      this.localStore = store
      this.activeProjectSession = session

      try {
        this.localEvents = new LocalProjectEvents()
        this.unsubscribeLocalEvents = this.localEvents.subscribe((event) => this._handleLocalProjectEvent(event))
      } catch {
        // Cross-tab notification is optional. IndexedDB's atomic
        // revision check still prevents stale writes without it.
        this.localEvents = null
      }

      let stored: StoredProject
      try {
        const startup = await resolveStartupProjectWithOrigin(store, session)
        stored = startup.project
        await this._applyStoredProject(stored, false)
        this._refreshDefinitions(instance)
        // The complete graph, source-producing definitions, and active
        // identity are now current. Reuse the Projects activation request;
        // the new-library empty fallback is deliberately left idle.
        if (startup.restored) this._renderCurrentProjectImmediatelyIfLive()
      } catch (error) {
        await this._refreshProjectList()
        const failedId = error instanceof StartupProjectLoadError ? error.projectId : this.activeProjectSession?.get() ?? null
        const summary = this.localProjects.find((project) => project.id === failedId)
        if (summary || error instanceof StartupProjectLoadError) {
          this._recordStartupProjectLoadFailure(summary ?? {
            id: failedId ?? 'unknown', name: 'Unreadable project', revision: 0, createdAt: '', updatedAt: '',
          }, error)
          return
        }
        throw error
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
      this.unsubscribeSemantic = instance.onSemanticChange(() => this._handleSemanticChange())
      this.unsubscribeInspect = instance.onInspect((nodeId) => void this._inspect(nodeId))
      this.unsubscribeInspectEnd = instance.onInspectEnd(() => this._handleInspectEnd())
      this.unsubscribeCameraDirty = this.viewer.onCameraChange(() => this._markDirty())
      this.localInitializing = false
    }
  }

  /** Keeps IndexedDB usable after one record fails validation or editor
   * reconstruction. No active ID/autosave controller means this blank safe
   * fallback can never write over the failed record. */
  private _recordStartupProjectLoadFailure(project: ProjectSummary, error: unknown): void {
    this.autosave?.destroy()
    this.autosave = undefined
    this.activeProjectId = null
    this.activeRevision = 0
    this.activeProjectSession?.clear()
    this.failedProject = project
    this.dirty = false
    this.autosaveStatus = 'idle'
    this.persistenceMessage = `Could not load local project "${project.name}". It was not changed: ${this._errorMessage(error)}`
    this._clearRenderedOutput()
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
        // Successful and in-progress IndexedDB autosaves are deliberately
        // silent. Only a real write failure (or the pre-existing explicit
        // cross-tab conflict recovery path) merits persistent feedback.
        this.persistenceMessage = state.status === 'error'
          ? 'Local saving failed; recent changes may be lost.'
          : state.status === 'conflict' ? state.message : null
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

  private async _applyStoredProject(stored: StoredProject, clearFileHandle = true, renderAfterActivation = false): Promise<void> {
    if (!this.editorInstance) throw new Error('The node editor is not ready.')
    if (stored.id !== this.activeProjectId) this._invalidateProjectRender()
    await this._restoreProject(stored.project)
    this.activeProjectId = stored.id
    this.failedProject = null
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
    if (renderAfterActivation) this._renderCurrentProjectImmediatelyIfLive()
  }

  /** Startup restore and visible Projects activation share this one immediate
   * Live request; the scheduler cancels stale delay and owns freshness. */
  private _renderCurrentProjectImmediatelyIfLive(): void {
    if (this.live) this.liveScheduler.renderImmediatelyIfStale()
  }

  /** A local-project replacement makes every delayed/running result from the
   * old graph invalid before restore can expose the new one. */
  private _invalidateProjectRender(): void {
    this.liveScheduler.projectChanged()
    this.executionGeneration.invalidate()
    if (this.renderStopTimer) clearTimeout(this.renderStopTimer)
    this.renderStopTimer = undefined
    this.activeExecution = null
    this.activeRenderOrigin = null
    this.rendering = false
    this.showRenderStop = false
    this.renderController.stop()
  }

  private async _restoreProject(project: ScadletProjectV1): Promise<void> {
    const instance = this.editorInstance ?? (await this.nodeEditor.whenReady())
    const rollbackProject = this._buildProject(instance)
    await instance.withDirtyTrackingSuspended(() =>
      restoreProject(project, {
        editor: instance.editor,
        creationContext: instance.creationContext,
        setNodePosition: async (id, position) => {
          await instance.area.translate(id, position)
        },
        setCollapsed: (id, collapsed) => instance.setCollapsed(id, collapsed),
        setViewport: async ({ x, y, k }) => {
          await instance.setPersistedViewport({ x, y, k })
        },
        setViewerCamera: (camera) => this.viewer.setCameraState(camera),
        clearDefinitions: () => instance.clearDefinitions(),
        registerDefinition: (definition) => instance.registerDefinition(definition),
        assignNodeToDefinition: (definitionId, nodeId) => instance.assignNodeToDefinition(definitionId, nodeId),
        rollbackProject,
      }),
    )
    // Inspect is transient and has no meaning across a committed project
    // replacement. Wait until restore succeeds so a rejected restore leaves
    // the previous project and its displayed result untouched.
    instance.clearInspect()
  }

  private _clearRenderedOutput(): void {
    this.renderError = null
    this.renderInfo = null
    this.scadSource = ''
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

  private async _switchLocalProject(id: string): Promise<void> {
    if (!this.localStore || !(await this._canLeaveCurrentProject())) {
      this.requestUpdate()
      return
    }
    try {
      const stored = await this.localStore.getProject(id)
      if (!stored) throw new Error('That local project no longer exists.')
      await this._applyStoredProject(stored, true, true)
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
      await this._applyStoredProject(stored, true, true)
      this.localEvents?.publish({ type: 'project-created', projectId: stored.id, revision: stored.revision })
      await this._refreshProjectList()
    } catch (error) {
      this.persistenceMessage = `Could not create a local project: ${this._errorMessage(error)}`
    }
  }

  private readonly _duplicateActiveProject = (): void => {
    void this._duplicateCurrentProject()
  }

  /** Creates a new local record from the complete canonical project payload;
   * the local store assigns the distinct browser identity and timestamps. */
  private async _duplicateCurrentProject(): Promise<void> {
    if (!this.localStore || !this.editorInstance || !this.activeProjectId || !(await this._canLeaveCurrentProject())) return
    const source = this._buildProject(this.editorInstance)
    const existingNames = new Set(this.localProjects.map((project) => project.name))
    const base = `${source.metadata.name} copy`
    let name = base
    let suffix = 2
    while (existingNames.has(name)) name = `${base} ${suffix++}`
    try {
      const stored = await this.localStore.createProject({ ...source, metadata: { ...source.metadata, name } })
      await this._applyStoredProject(stored, true, true)
      this.localEvents?.publish({ type: 'project-created', projectId: stored.id, revision: stored.revision })
      await this._refreshProjectList()
      this.projectsMenuOpen = false
    } catch (error) {
      this.persistenceMessage = `Could not duplicate the local project: ${this._errorMessage(error)}`
    }
  }

  private readonly _deleteCurrentProject = (): void => {
    void this._deleteActiveProject()
  }

  private async _deleteActiveProject(): Promise<void> {
    const projectId = this.activeProjectId ?? this.failedProject?.id
    const projectName = this.activeProjectId ? this.projectMetadata.name : this.failedProject?.name
    if (!this.localStore || !projectId || !projectName) return
    if (!window.confirm(`Delete "${projectName}" from this browser? Exported files are not affected.`)) return
    if (!(await this._canLeaveCurrentProject())) return

    const deletedId = projectId
    try {
      await this.localStore.deleteProject(deletedId)
      this.activeProjectSession?.clear()
      this.localEvents?.publish({ type: 'project-deleted', projectId: deletedId })
      this.failedProject = null
      const replacement = await resolveStartupProject(this.localStore, this.activeProjectSession!)
      await this._applyStoredProject(replacement, true, true)
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
      await this._applyStoredProject(stored, false, true)
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
    if (!(error instanceof Error)) return String(error)
    // Local-record loading wraps the validation detail to preserve recovery
    // identity. Show the learner the underlying validation failure instead
    // of an opaque wrapper, while retaining the outer operation context at
    // each call site.
    const cause = (error as Error & { cause?: unknown }).cause
    return cause instanceof Error ? this._errorMessage(cause) : error.message
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

  private readonly _openModuleDialog = (): void => {
    this.editingModuleId = null
    this.moduleName = ''
    this.moduleError = null
    this.moduleDialogOpen = true
  }

  private readonly _cancelModuleDialog = (): void => {
    this.moduleDialogOpen = false
    this.moduleError = null
    this.editingModuleId = null
  }

  private readonly _onModuleNameInput = (event: Event): void => {
    this.moduleName = (event.target as HTMLInputElement).value
    this.moduleError = null
  }

  private readonly _submitModule = (event: SubmitEvent): void => {
    event.preventDefault()
    void this._createModule()
  }

  private async _createModule(): Promise<void> {
    const instance = this.editorInstance ?? (await this.nodeEditor.whenReady())
    try {
      if (this.editingModuleId) await instance.renameModule(this.editingModuleId, this.moduleName)
      else await instance.createModule(this.moduleName)
      this._refreshDefinitions(instance)
      this.moduleDialogOpen = false
      this.moduleError = null
      this.editingModuleId = null
    } catch (error) {
      this.moduleError = this._errorMessage(error)
    }
  }

  private readonly _openRenameModuleDialog = (event: CustomEvent<{ definitionId: string }>): void => {
    const definition = this.moduleDefinitions.find((item) => item.id === event.detail.definitionId)
    if (!definition) return
    this.editingModuleId = definition.id
    this.moduleName = definition.name
    this.moduleError = null
    this.moduleDialogOpen = true
  }

  private readonly _focusModule = (event: CustomEvent<{ definitionId: string }>): void => {
    void this.editorInstance?.focusModule(event.detail.definitionId)
  }

  private readonly _deleteModule = (event: CustomEvent<{ definitionId: string }>): void => {
    void this._deleteModuleById(event.detail.definitionId)
  }

  private async _deleteModuleById(definitionId: string): Promise<void> {
    const instance = this.editorInstance ?? (await this.nodeEditor.whenReady())
    try {
      await instance.deleteModule(definitionId)
      this._refreshDefinitions(instance)
    } catch (error) {
      this.persistenceMessage = this._errorMessage(error)
    }
  }

  /** Splits the shared definition registry into Modules and Functions for
   * the sidebar's separate `MY MODULES`/`MY FUNCTIONS` sections. */
  private _refreshDefinitions(instance: SCADletEditor): void {
    const all = instance.getDefinitions()
    this.moduleDefinitions = all.filter((definition) => definition.kind === 'module')
    this.functionDefinitions = all.filter((definition) => definition.kind === 'function')
  }

  private readonly _openFunctionDialog = (): void => {
    this.editingFunctionId = null
    this.functionName = ''
    this.functionError = null
    this.functionDialogOpen = true
  }

  private readonly _cancelFunctionDialog = (): void => {
    this.functionDialogOpen = false
    this.functionError = null
    this.editingFunctionId = null
  }

  private readonly _onFunctionNameInput = (event: Event): void => {
    this.functionName = (event.target as HTMLInputElement).value
    this.functionError = null
  }

  private readonly _submitFunction = (event: SubmitEvent): void => {
    event.preventDefault()
    void this._createFunction()
  }

  private async _createFunction(): Promise<void> {
    const instance = this.editorInstance ?? (await this.nodeEditor.whenReady())
    try {
      if (this.editingFunctionId) await instance.renameFunction(this.editingFunctionId, this.functionName)
      else await instance.createFunction(this.functionName)
      this._refreshDefinitions(instance)
      this.functionDialogOpen = false
      this.functionError = null
      this.editingFunctionId = null
    } catch (error) {
      this.functionError = this._errorMessage(error)
    }
  }

  private readonly _openRenameFunctionDialog = (event: CustomEvent<{ definitionId: string }>): void => {
    const definition = this.functionDefinitions.find((item) => item.id === event.detail.definitionId)
    if (!definition) return
    this.editingFunctionId = definition.id
    this.functionName = definition.name
    this.functionError = null
    this.functionDialogOpen = true
  }

  private readonly _focusFunction = (event: CustomEvent<{ definitionId: string }>): void => {
    void this.editorInstance?.focusFunction(event.detail.definitionId)
  }

  private readonly _deleteFunction = (event: CustomEvent<{ definitionId: string }>): void => {
    void this._deleteFunctionById(event.detail.definitionId)
  }

  private async _deleteFunctionById(definitionId: string): Promise<void> {
    const instance = this.editorInstance ?? (await this.nodeEditor.whenReady())
    try {
      await instance.deleteFunction(definitionId)
      this._refreshDefinitions(instance)
    } catch (error) {
      this.persistenceMessage = this._errorMessage(error)
    }
  }

  private readonly _onProjectNameKeydown = (event: KeyboardEvent): void => {
    if (event.key !== 'Enter') return
    event.preventDefault()
    ;(event.target as HTMLInputElement).blur()
  }

  private readonly _commitProjectName = (event: Event): void => {
    const input = event.target as HTMLInputElement
    const trimmed = input.value.trim()
    const name = trimmed || UNTITLED_PROJECT_NAME
    input.value = name
    if (name === this.projectMetadata.name && this.hasExplicitName === (trimmed.length > 0)) return
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
      isCollapsed: (id) => instance.isCollapsed(id),
      viewport: instance.getPersistedViewport(),
      viewerCamera: this.viewer.getPersistedCameraState(),
      definitions: instance.getDefinitions(),
      getNodeScope: (id) => instance.getNodeScope(id),
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
        await this._applyStoredProject(stored, false, true)
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

  private readonly _onKeyDown = (event: KeyboardEvent): void => {
    if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 's') return
    event.preventDefault()
    void this._saveAs()
  }

  private _beginExecution(kind: 'render' | 'inspect', origin: 'manual' | 'live' | null = null): number {
    const generation = this.executionGeneration.begin()
    if (this.renderController.isRendering) this.renderController.stop()
    if (this.renderStopTimer) clearTimeout(this.renderStopTimer)
    this.activeExecution = kind
    this.activeRenderOrigin = kind === 'render' ? origin : null
    if (kind === 'inspect' || kind === 'render') {
      // A running replacement is never allowed to expose prior bytes as a
      // fresh export. The visible mesh itself remains until success.
      this.stl = null
    }
    this.rendering = true
    this.showRenderStop = false
    this.renderStopTimer = setTimeout(() => {
      if (this.rendering && this.activeExecution === kind) this.showRenderStop = true
    }, 200)
    this.renderError = null
    return generation
  }

  private _finishExecution(generation: number): void {
    if (!this.executionGeneration.isCurrent(generation)) return
    if (this.renderStopTimer) clearTimeout(this.renderStopTimer)
    this.renderStopTimer = undefined
    this.activeExecution = null
    this.activeRenderOrigin = null
    this.rendering = false
    this.showRenderStop = false
  }

  /** A semantic edit invalidates Inspect and schedules through the one
   * session-only Live policy. Presentation and persistence events never call
   * this method because they are not editor semantic changes. */
  private _handleSemanticChange(): void {
    // The empty-preview note describes a completed Geometry result. A graph
    // edit leaves the blank canvas in place but makes that old result stale.
    this.renderInfo = null
    // Keep the old successful mesh visible as helpful context, but never
    // treat its bytes as an export for the changed graph.
    this.stl = null
    if (this.activeExecution === 'inspect' || this.activeRenderOrigin === 'live') {
      this.executionGeneration.invalidate()
      if (this.renderStopTimer) clearTimeout(this.renderStopTimer)
      this.renderStopTimer = undefined
      this.activeExecution = null
      this.activeRenderOrigin = null
      this.rendering = false
      this.showRenderStop = false
      this.renderController.stop()
    }
    this.liveScheduler.semanticChange()
  }

  /** Prevents a completed async Inspect from restoring provenance after the
   * user explicitly ended it in the editor. The last valid preview remains
   * visible, matching `InspectManager.clear()`; only the in-flight work and
   * its ability to commit are cancelled. */
  private _handleInspectEnd(): void {
    if (this.activeExecution === 'inspect' || this.activeRenderOrigin === 'live') {
      this.executionGeneration.invalidate()
      if (this.renderStopTimer) clearTimeout(this.renderStopTimer)
      this.renderStopTimer = undefined
      this.activeExecution = null
      this.activeRenderOrigin = null
      this.rendering = false
      this.showRenderStop = false
      this.renderController.stop()
    }
    this.liveScheduler.resumeAfterInspect()
  }

  private async _render() {
    // A direct Render action wins over a quiet-period request and prevents a
    // later duplicate automatic run for the same revision.
    this.liveScheduler.cancelPending()
    await this._renderProject('manual', this.liveScheduler.revision)
  }

  private async _renderLive(revision: number): Promise<void> {
    if (!this.live || revision !== this.liveScheduler.revision) return
    await this._renderProject('live', revision)
  }

  private async _renderProject(origin: 'manual' | 'live', revision: number): Promise<void> {
    const inspectedId = this.editorInstance?.getInspectedNodeId() ?? null
    const inspectTarget = origin === 'live' && inspectedId !== null && this.editorInstance?.isGeometryNode(inspectedId)
      ? inspectedId
      : null
    // Manual Render is the explicit return to the complete project. Live
    // keeps an active Geometry Inspect rooted at that same subtree.
    if (origin === 'manual') this.editorInstance?.clearInspect()
    const generation = this._beginExecution('render', origin)
    this.renderInfo = null
    const tStart = performance.now()
    try {
      // Toolbar Render always evaluates the complete project. A temporary
      // Inspect root never changes normal preview or `.scad` export scope.
      const source = await this.nodeEditor.evaluate(inspectTarget ?? undefined)
      if (!this._isCurrentRender(generation, revision, inspectTarget)) return
      this.scadSource = source
      if (!source.trim()) {
        this.renderError = 'Nothing to render - add at least one node.'
        return
      }
      const cachedResult = origin === 'live' && inspectTarget === null
        ? this.previewCache.get(source, GEOMETRY_RENDER_OPTIONS)
        : undefined
      const result = cachedResult ?? await this.renderController.render(source, {
        renderOptions: GEOMETRY_RENDER_OPTIONS,
        ...(origin === 'live' ? { timeoutMs: AUTOMATIC_RENDER_TIMEOUT_MS } : {}),
      })
      if (!this._isCurrentRender(generation, revision, inspectTarget)) return
      if (result.kind === 'empty') {
        this.stl = null
        this.viewer.clear()
        this.renderInfo = t('render.emptyGeometry')
      } else {
        this.stl = result.stl
        this.viewer.showSTL(result.stl)
      }
      // Manual Render deliberately bypasses reads but refreshes the same
      // session cache. Inspect-scoped results skip it, and stale results have
      // already returned through the generation/revision guard above.
      if (inspectTarget === null) {
        if (cachedResult === undefined) this.previewCache.set(source, GEOMETRY_RENDER_OPTIONS, result)
        this.liveScheduler.markSuccessful(revision)
      }
      console.log(`[scadlet-app] render total=${(performance.now() - tStart).toFixed(1)}ms`)
    } catch (error) {
      if (!this._isCurrentRender(generation, revision, inspectTarget)) return
      const message = error instanceof Error ? error.message : String(error)
      if (origin === 'live' && error instanceof RenderTimeoutError) {
        this._disableTimedOutAutomaticRender()
      } else if (message !== 'Render stopped') {
        this.renderInfo = null
        this.renderError = message
      }
    } finally {
      this._finishExecution(generation)
    }
  }

  private _isCurrentRender(generation: number, revision: number, inspectTarget: string | null = null): boolean {
    return this.executionGeneration.isCurrent(generation) && revision === this.liveScheduler.revision
      && (inspectTarget === null || this.editorInstance?.getInspectedNodeId() === inspectTarget)
  }

  private _disableTimedOutAutomaticRender(): void {
    // Reaching the automatic-only budget is Live-policy feedback, not an
    // OpenSCAD compiler error. Manual Render remains available without it.
    this.live = false
    this.liveScheduler.setLive(false)
    this.renderInfo = t('render.liveDisabledSlow')
  }

  private readonly _setLive = (event: CustomEvent<{ live: boolean }>): void => {
    this.live = event.detail.live
    this.liveScheduler.setLive(this.live)
  }

  /** Executes exactly one OpenSCAD-backed evaluation for the node selected
   * by an Inspect double-click. It never starts live/background evaluation. */
  private async _inspect(nodeId: string): Promise<void> {
    // An explicit Inspect wins over semantic edits still waiting for Live's
    // quiet-period deadline. Otherwise that delayed run can begin while the
    // OpenSCAD-backed Inspect is in flight and cancel it before it commits.
    this.liveScheduler.cancelPending()
    this.liveScheduler.invalidatePreviewForInspect()
    const generation = this._beginExecution('inspect')
    try {
      const inspected = await this.nodeEditor.evaluateInspect(nodeId)
      if (!this.executionGeneration.isCurrent(generation) || inspected.kind === 'missing') return

      if (inspected.kind === 'value') {
        const source = inspected.source ?? `echo("__SCADLET_VALUE__:", ${inspected.expression});`
        const value = await this.renderController.inspectValue(source)
        if (!this.executionGeneration.isCurrent(generation)) return
        this.scadSource = source
        this.editorInstance?.commitValueInspect(nodeId, value)
        return
      }

      if (!inspected.source.trim()) {
        this.renderInfo = null
        this.renderError = 'Nothing to render - add at least one node.'
        return
      }
      const result = await this.renderController.render(inspected.source)
      if (!this.executionGeneration.isCurrent(generation)) return
      this.scadSource = inspected.source
      if (result.kind === 'empty') {
        this.stl = null
        this.viewer.clear()
        this.renderInfo = t('render.emptyGeometry')
        // A Geometry Inspect marker certifies a displayed mesh. A valid
        // empty result replaces any older preview, so it must not inherit or
        // create that visible-result provenance.
        this.editorInstance?.clearInspect()
      } else {
        this.renderInfo = null
        // Inspect is a transient subtree preview, never a whole-project STL
        // export. Downloading STL after an Inspect therefore runs Render.
        this.stl = null
        this.viewer.showSTL(result.stl)
        this.editorInstance?.commitGeometryInspect(nodeId)
      }
    } catch (error) {
      if (!this.executionGeneration.isCurrent(generation)) return
      const message = error instanceof Error ? error.message : String(error)
      if (message !== 'Render stopped') {
        this.renderInfo = null
        this.renderError = message
      }
    } finally {
      this._finishExecution(generation)
    }
  }

  private _stop() {
    if (this.activeRenderOrigin === 'live') this.liveScheduler.stopCurrentRevision()
    this.executionGeneration.invalidate()
    if (this.renderStopTimer) clearTimeout(this.renderStopTimer)
    this.renderStopTimer = undefined
    this.activeExecution = null
    this.activeRenderOrigin = null
    this.renderController.stop()
    this.rendering = false
    this.showRenderStop = false
  }

  private async _downloadScad() {
    try {
      const source = await this.nodeEditor.evaluate()
      this.scadSource = source
      triggerDownload(scadBlob(source), this._exportFilename('.scad'))
    } catch (error) {
      this.renderError = this._errorMessage(error)
    }
  }

  private async _downloadStl() {
    // A changed graph invalidates `stl`; use the normal manual render path
    // and download only a successful non-empty result from that same source.
    if (!this.stl) await this._render()
    if (this.stl) triggerDownload(stlBlob(this.stl), this._exportFilename('.stl'))
  }

  private _exportFilename(extension: '.scad' | '.stl'): string {
    return `${sanitizeFilename(this.projectMetadata.name)}${extension}`
  }

  disconnectedCallback() {
    super.disconnectedCallback()
    window.removeEventListener('keydown', this._onKeyDown)
    this.unsubscribeDirty?.()
    this.unsubscribeSemantic?.()
    this.unsubscribeInspect?.()
    this.unsubscribeInspectEnd?.()
    this.unsubscribeCameraDirty?.()
    this.unsubscribeDefinitions?.()
    this.unsubscribeLocalEvents?.()
    this.localEvents?.close()
    this.autosave?.destroy()
    this.liveScheduler.destroy()
    this.previewCache.clear()
    this.renderController.destroy()
    if (this.renderStopTimer) clearTimeout(this.renderStopTimer)
    this.mainResizeObserver?.disconnect()
    this.sideResizeObserver?.disconnect()
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'scadlet-app': ScadletApp
  }
}

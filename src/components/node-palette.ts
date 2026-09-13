import { LitElement, css, html, nothing } from 'lit'
import { customElement, property } from 'lit/decorators.js'

import { FUNCTION_CALL_DRAG_MIME_TYPE, MODULE_CALL_DRAG_MIME_TYPE, NODE_CATALOG, NODE_CATEGORIES, NODE_DRAG_MIME_TYPE, NODE_DRAG_PARAMS_MIME_TYPE, nodeTypeIcon, type NodeCatalogEntry, type NodeCategory } from '../editor/node-catalog'
import { catalogProducesGeometry } from '../editor/geometry-accent'
import { compactIcon } from './icons'
import { t } from '../i18n/translate'

/**
 * A persistent, always-visible sidebar listing available node types,
 * grouped by category (see `NODE_CATEGORIES`/`NODE_CATALOG`). This is the
 * single place node types are listed in the UI - it never constructs
 * nodes itself; graph-node placement is always explicit drag-and-drop:
 *
 *  - drag: native HTML5 drag-and-drop carries the catalog `type` id as
 *    `NODE_DRAG_MIME_TYPE`; `<node-editor>` reads it on `drop` and
 *    converts the drop position into graph coordinates itself.
 *
 * Labels are resolved through `t()` (see `src/i18n/translate.ts`) rather
 * than hardcoded strings, so a future German dictionary is a data change,
 * not a UI rewrite.
 */
@customElement('node-palette')
export class NodePaletteElement extends LitElement {
  private readonly selectedOperations = new Map<string, string>()
  /** Project-owned definitions deliberately live beside the static catalog.
   * Their entry creates a generic Call node; it is never a static type named
   * after the Module's display name. */
  @property({ attribute: false })
  modules: readonly { id: string; name: string }[] = []
  /** Same placement/interaction pattern as `modules`, but a Function entry
   * is only a real (draggable) Call source once its result type is
   * resolved - an unresolved Function's entry stays visibly non-callable. */
  @property({ attribute: false })
  functions: readonly { id: string; name: string; callable: boolean }[] = []
  static styles = css`
    :host {
      display: block;
      overflow-y: auto;
      background: #202020;
      color: #eee;
      font: 13px system-ui, sans-serif;
      color-scheme: dark;
      user-select: none;
      -webkit-user-select: none;
      --geometry-socket-color: var(--scadlet-geometry-socket, #7ac0ff);
    }

    h2 {
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: #999;
      margin: 0;
      padding: 10px 12px 6px;
    }

    .category-title {
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: #999;
      padding: 10px 12px 4px;
    }

    .node-item {
      display: block;
      width: calc(100% - 16px);
      box-sizing: border-box;
      margin: 0 8px 4px;
      padding: 6px 10px;
      border-radius: 4px;
      border: 1px solid #3a3a3a;
      background: #2a2a2a;
      color: inherit;
      font: inherit;
      text-align: left;
      cursor: grab;
    }

    .node-item:hover {
      border-color: #7ac0ff;
      background: #2f2f2f;
    }

    .node-item:active {
      cursor: grabbing;
    }

    /* Decorative only: the adjacent readable label already supplies the
       accessible name (node-style.md "Icons in nodes and palette"). */
    .node-item-icon {
      display: inline-flex;
      flex: none;
      width: 15px;
      height: 15px;
      margin-right: 6px;
      vertical-align: -3px;
      opacity: 0.85;
    }

    .node-item-icon svg {
      width: 100%;
      height: 100%;
      fill: none;
      stroke: currentcolor;
      stroke-width: 1.6;
      stroke-linecap: round;
      stroke-linejoin: round;
    }

    /* The same narrow inset edge used on Geometry-producing canvas nodes.
       It adds no layout width, so palette scanning and drag targets stay
       exactly as compact as before. */
    .node-item--geometry-output {
      box-shadow: inset 3px 0 0 var(--geometry-socket-color);
    }

    .node-item--operation {
      display: grid;
      grid-template-columns: minmax(0, 1fr);
      grid-template-rows: auto 28px;
      align-items: center;
      gap: 3px 6px;
      padding: 5px 8px;
      cursor: grab;
    }

    .node-item--operation:active { cursor: grabbing; }
    .node-operation-label {
      grid-column: 1 / -1;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .node-item--operation select {
      min-width: 0;
      width: 100%;
      height: 28px;
      box-sizing: border-box;
      padding: 2px 6px;
      border: 1px solid #666;
      border-radius: 4px;
      background: #1d1d1d;
      color: #f5f5f5;
      color-scheme: dark;
      font: inherit;
      user-select: auto;
      -webkit-user-select: auto;
    }

    .node-item--operation select:hover { border-color: #9b9b9b; background: #252525; }
    .node-item--operation select:focus-visible {
      border-color: #7ac0ff;
      outline: 2px solid rgb(122 192 255 / 0.45);
      outline-offset: 1px;
    }
    .node-item--operation select:disabled { color: #999; border-color: #4a4a4a; background: #242424; }
    .node-item--operation select option { background: #1d1d1d; color: #f5f5f5; }

    .module-entry { display: flex; align-items: center; gap: 4px; margin: 0 8px 4px; }
    .module-entry .module-item { margin: 0; flex: 1; }
    .module-action { padding: 4px 6px; }

    .module-item[aria-disabled='true'] {
      cursor: not-allowed;
      opacity: 0.55;
    }
  `

  render() {
    return html`
      <h2>${t('palette.title')}</h2>
      ${NODE_CATEGORIES.map((category) => this._renderCategory(category))}
      <div class="category" aria-label=${t('definition.myModules')}>
        <div class="category-title">${t('definition.myModules')}</div>
        ${this.modules.map((module) => html`
          <div class="module-entry" data-definition-id=${module.id}>
            <div role="listitem" class="node-item module-item node-item--geometry-output" draggable="true"
              @dragstart=${(event: DragEvent) => this._onModuleDragStart(event, module.id)} aria-label=${module.name}><span class="node-item-icon">${compactIcon('module')}</span>${module.name}</div>
            <button type="button" class="module-action" aria-label=${t('definition.focusModule').replace('{name}', module.name)} @click=${() => this._moduleAction('focus-module', module.id)}>⌖</button>
            <button type="button" class="module-action" aria-label=${t('definition.editModule').replace('{name}', module.name)} @click=${() => this._moduleAction('edit-module', module.id)}>✎</button>
            <button type="button" class="module-action" aria-label=${t('definition.deleteModule').replace('{name}', module.name)} @click=${() => this._moduleAction('delete-module', module.id)}>×</button>
          </div>
        `)}
        <button type="button" class="node-item" @click=${this._onNewModule}>${t('definition.newModule')}</button>
      </div>
      <div class="category" aria-label=${t('definition.myFunctions')}>
        <div class="category-title">${t('definition.myFunctions')}</div>
        ${this.functions.map((functionDef) => html`
          <div class="module-entry" data-definition-id=${functionDef.id}>
            <div role="listitem" class="node-item module-item" draggable=${functionDef.callable} aria-disabled=${!functionDef.callable}
              @dragstart=${(event: DragEvent) => this._onFunctionDragStart(event, functionDef.id, functionDef.callable)} aria-label=${functionDef.name}><span class="node-item-icon">${compactIcon('function')}</span>${functionDef.name}</div>
            <button type="button" class="module-action" aria-label=${t('definition.focusFunction').replace('{name}', functionDef.name)} @click=${() => this._functionAction('focus-function', functionDef.id)}>⌖</button>
            <button type="button" class="module-action" aria-label=${t('definition.editFunction').replace('{name}', functionDef.name)} @click=${() => this._functionAction('edit-function', functionDef.id)}>✎</button>
            <button type="button" class="module-action" aria-label=${t('definition.deleteFunction').replace('{name}', functionDef.name)} @click=${() => this._functionAction('delete-function', functionDef.id)}>×</button>
          </div>
        `)}
        <button type="button" class="node-item" @click=${this._onNewFunction}>${t('definition.newFunction')}</button>
      </div>
    `
  }

  private _renderCategory(category: NodeCategory) {
    const entries = NODE_CATALOG.filter((entry) => entry.palette !== false && entry.category === category.id)
    if (entries.length === 0) return nothing

    return html`
      <div class="category">
        <div class="category-title">${t(category.labelKey)}</div>
        ${entries.map((entry) => entry.paletteOperation ? this._renderOperationEntry(entry) : html`
            <div
              role="listitem"
              class=${catalogProducesGeometry(entry) ? 'node-item node-item--geometry-output' : 'node-item'}
              data-node-type=${entry.type}
              draggable="true"
              @dragstart=${(event: DragEvent) => this._onDragStart(event, entry.type)}
              aria-label=${t(entry.labelKey)}
            >
              <span class="node-item-icon">${compactIcon(nodeTypeIcon(entry.type))}</span>${t(entry.labelKey)}
            </div>
          `)}
      </div>
    `
  }

  private _renderOperationEntry(entry: NodeCatalogEntry) {
    const config = entry.paletteOperation!
    const selectedOperation = this.selectedOperations.get(entry.type) ?? config.defaultValue
    return html`
      <div role="listitem" class=${catalogProducesGeometry(entry) ? 'node-item node-item--operation node-item--geometry-output' : 'node-item node-item--operation'} data-node-type=${entry.type} draggable="true"
        @dragstart=${(event: DragEvent) => this._onOperationDragStart(event, entry, selectedOperation)} aria-label=${t(entry.labelKey)}>
        <span class="node-operation-label" title=${t(entry.labelKey)}><span class="node-item-icon">${compactIcon(nodeTypeIcon(entry.type))}</span>${t(entry.labelKey)}</span>
        <select aria-label=${t(config.accessibleLabelKey)} @pointerdown=${this._stopOperationControlGesture} @dragstart=${this._stopOperationControlGesture} @change=${(event: Event) => {
          const select = event.currentTarget as HTMLSelectElement
          this.selectedOperations.set(entry.type, select.value)
        }}>
          ${config.options.map((option) => html`<option value=${option.value} ?selected=${option.value === selectedOperation}>${option.label}</option>`)}
        </select>
      </div>
    `
  }

  /** The entry is the native drag source; controls within it stay ordinary
   * controls so a click/touch on the select never turns into node placement. */
  private _onOperationDragStart(event: DragEvent, entry: NodeCatalogEntry, selectedOperation: string): void {
    if (event.composedPath().some((item) => item instanceof HTMLSelectElement)) {
      event.preventDefault()
      return
    }
    const item = event.currentTarget as HTMLElement
    const selected = item.querySelector('select')?.value ?? selectedOperation
    this._onDragStart(event, entry.type, entry.paletteOperation!.createParams(selected))
  }

  private _stopOperationControlGesture(event: Event): void {
    event.stopPropagation()
    if (event.type === 'dragstart') event.preventDefault()
  }

  private _onDragStart(event: DragEvent, type: string, params?: Record<string, unknown>): void {
    if (!event.dataTransfer) return
    event.dataTransfer.effectAllowed = 'copy'
    event.dataTransfer.setData(NODE_DRAG_MIME_TYPE, type)
    if (params) event.dataTransfer.setData(NODE_DRAG_PARAMS_MIME_TYPE, JSON.stringify(params))
  }

  private _onModuleDragStart(event: DragEvent, definitionId: string): void {
    if (!event.dataTransfer) return
    event.dataTransfer.effectAllowed = 'copy'
    event.dataTransfer.setData(MODULE_CALL_DRAG_MIME_TYPE, definitionId)
  }

  private _onFunctionDragStart(event: DragEvent, definitionId: string, callable: boolean): void {
    if (!callable) { event.preventDefault(); return }
    if (!event.dataTransfer) return
    event.dataTransfer.effectAllowed = 'copy'
    event.dataTransfer.setData(FUNCTION_CALL_DRAG_MIME_TYPE, definitionId)
  }

  private _onNewModule(): void {
    this.dispatchEvent(new CustomEvent('new-module', { bubbles: true, composed: true }))
  }

  private _onNewFunction(): void {
    this.dispatchEvent(new CustomEvent('new-function', { bubbles: true, composed: true }))
  }

  private _moduleAction(type: 'focus-module' | 'edit-module' | 'delete-module', definitionId: string): void {
    this.dispatchEvent(new CustomEvent(type, { detail: { definitionId }, bubbles: true, composed: true }))
  }

  private _functionAction(type: 'focus-function' | 'edit-function' | 'delete-function', definitionId: string): void {
    this.dispatchEvent(new CustomEvent(type, { detail: { definitionId }, bubbles: true, composed: true }))
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'node-palette': NodePaletteElement
  }
}

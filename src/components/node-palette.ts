import { LitElement, css, html, nothing } from 'lit'
import { customElement, property } from 'lit/decorators.js'

import { MODULE_CALL_DRAG_MIME_TYPE, NODE_CATALOG, NODE_CATEGORIES, NODE_DRAG_MIME_TYPE, type NodeCategory } from '../editor/node-catalog'
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
  /** Project-owned definitions deliberately live beside the static catalog.
   * Their entry creates a generic Call node; it is never a static type named
   * after the Module's display name. */
  @property({ attribute: false })
  modules: readonly { id: string; name: string }[] = []
  static styles = css`
    :host {
      display: block;
      overflow-y: auto;
      background: #202020;
      color: #eee;
      font: 13px system-ui, sans-serif;
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

    .module-entry { display: flex; align-items: center; gap: 4px; margin: 0 8px 4px; }
    .module-entry .module-item { margin: 0; flex: 1; }
    .module-action { padding: 4px 6px; }
  `

  render() {
    return html`
      <h2>${t('palette.title')}</h2>
      ${NODE_CATEGORIES.map((category) => this._renderCategory(category))}
      <div class="category" aria-label=${t('definition.myModules')}>
        <div class="category-title">${t('definition.myModules')}</div>
        ${this.modules.map((module) => html`
          <div class="module-entry" data-definition-id=${module.id}>
            <div role="listitem" class="node-item module-item" draggable="true"
              @dragstart=${(event: DragEvent) => this._onModuleDragStart(event, module.id)} aria-label=${module.name}>${module.name}</div>
            <button type="button" class="module-action" aria-label=${t('definition.focusModule').replace('{name}', module.name)} @click=${() => this._moduleAction('focus-module', module.id)}>⌖</button>
            <button type="button" class="module-action" aria-label=${t('definition.editModule').replace('{name}', module.name)} @click=${() => this._moduleAction('edit-module', module.id)}>✎</button>
            <button type="button" class="module-action" aria-label=${t('definition.deleteModule').replace('{name}', module.name)} @click=${() => this._moduleAction('delete-module', module.id)}>×</button>
          </div>
        `)}
        <button type="button" class="node-item" @click=${this._onNewModule}>${t('definition.newModule')}</button>
      </div>
    `
  }

  private _renderCategory(category: NodeCategory) {
    const entries = NODE_CATALOG.filter((entry) => entry.palette !== false && entry.category === category.id)
    if (entries.length === 0) return nothing

    return html`
      <div class="category">
        <div class="category-title">${t(category.labelKey)}</div>
        ${entries.map(
          (entry) => html`
            <div
              role="listitem"
              class="node-item"
              draggable="true"
              @dragstart=${(event: DragEvent) => this._onDragStart(event, entry.type)}
              aria-label=${t(entry.labelKey)}
            >
              ${t(entry.labelKey)}
            </div>
          `,
        )}
      </div>
    `
  }

  private _onDragStart(event: DragEvent, type: string): void {
    if (!event.dataTransfer) return
    event.dataTransfer.effectAllowed = 'copy'
    event.dataTransfer.setData(NODE_DRAG_MIME_TYPE, type)
  }

  private _onModuleDragStart(event: DragEvent, definitionId: string): void {
    if (!event.dataTransfer) return
    event.dataTransfer.effectAllowed = 'copy'
    event.dataTransfer.setData(MODULE_CALL_DRAG_MIME_TYPE, definitionId)
  }

  private _onNewModule(): void {
    this.dispatchEvent(new CustomEvent('new-module', { bubbles: true, composed: true }))
  }

  private _moduleAction(type: 'focus-module' | 'edit-module' | 'delete-module', definitionId: string): void {
    this.dispatchEvent(new CustomEvent(type, { detail: { definitionId }, bubbles: true, composed: true }))
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'node-palette': NodePaletteElement
  }
}

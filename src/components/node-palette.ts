import { LitElement, css, html, nothing } from 'lit'
import { customElement } from 'lit/decorators.js'

import { NODE_CATALOG, NODE_CATEGORIES, NODE_DRAG_MIME_TYPE, type NodeCategory } from '../editor/node-catalog'
import { t } from '../i18n/translate'

/**
 * A persistent, always-visible sidebar listing available node types,
 * grouped by category (see `NODE_CATEGORIES`/`NODE_CATALOG`). This is the
 * single place node types are listed in the UI - it never constructs
 * nodes itself, it only tells the surrounding app *what* the user picked:
 *
 *  - drag: native HTML5 drag-and-drop carries the catalog `type` id as
 *    `NODE_DRAG_MIME_TYPE`; `<node-editor>` reads it on `drop` and
 *    converts the drop position into graph coordinates itself.
 *  - click (fallback): dispatches a `node-palette-pick` event with the
 *    same `type` id; the app shell asks the editor to place it near the
 *    visible canvas center.
 *
 * Labels are resolved through `t()` (see `src/i18n/translate.ts`) rather
 * than hardcoded strings, so a future German dictionary is a data change,
 * not a UI rewrite.
 */
@customElement('node-palette')
export class NodePaletteElement extends LitElement {
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
  `

  render() {
    return html`
      <h2>${t('palette.title')}</h2>
      ${NODE_CATEGORIES.map((category) => this._renderCategory(category))}
    `
  }

  private _renderCategory(category: NodeCategory) {
    const entries = NODE_CATALOG.filter((entry) => entry.category === category.id)
    if (entries.length === 0) return nothing

    return html`
      <div class="category">
        <div class="category-title">${t(category.labelKey)}</div>
        ${entries.map(
          (entry) => html`
            <button
              type="button"
              class="node-item"
              draggable="true"
              @dragstart=${(event: DragEvent) => this._onDragStart(event, entry.type)}
              @click=${() => this._onPick(entry.type)}
            >
              ${t(entry.labelKey)}
            </button>
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

  private _onPick(type: string): void {
    this.dispatchEvent(
      new CustomEvent('node-palette-pick', { detail: { type }, bubbles: true, composed: true }),
    )
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'node-palette': NodePaletteElement
  }
}

import { LitElement, css, html } from 'lit'
import { customElement, property } from 'lit/decorators.js'

export type SplitterOrientation = 'vertical' | 'horizontal'

/**
 * A thin, project-owned draggable divider between two layout panes.
 *
 * It has no opinion about sizing: it only reports pointer positions via a
 * `splitter-move` custom event (bubbling/composed so a parent shadow root
 * can listen with a plain `@splitter-move` binding). The parent layout
 * owns clamping and applying the resulting pane size - this keeps the
 * same component reusable for both the node-editor/preview split
 * (vertical divider, horizontal drag) and the preview/debug-output split
 * (horizontal divider, vertical drag). See `scadlet-app.ts`.
 */
@customElement('layout-splitter')
export class LayoutSplitter extends LitElement {
  static styles = css`
    :host {
      display: block;
      position: relative;
      flex: none;
      touch-action: none;
      z-index: 1;
    }

    :host([orientation='vertical']) {
      width: 7px;
      cursor: col-resize;
    }

    :host([orientation='horizontal']) {
      height: 7px;
      cursor: row-resize;
    }

    .hit-area {
      position: absolute;
      inset: 0;
    }

    /* Enlarge the pointer hit area beyond the visible line, without
       widening the grid/flex track this element occupies. */
    :host([orientation='vertical']) .hit-area {
      left: -4px;
      right: -4px;
    }

    :host([orientation='horizontal']) .hit-area {
      top: -4px;
      bottom: -4px;
    }

    .line {
      position: absolute;
      background: #444;
      transition: background-color 0.1s ease;
    }

    :host([orientation='vertical']) .line {
      left: 3px;
      width: 1px;
      top: 0;
      bottom: 0;
    }

    :host([orientation='horizontal']) .line {
      top: 3px;
      height: 1px;
      left: 0;
      right: 0;
    }

    :host(:hover) .line,
    :host(.active) .line {
      background: #7ac0ff;
    }
  `

  @property({ reflect: true })
  orientation: SplitterOrientation = 'vertical'

  private activePointerId: number | null = null

  render() {
    return html`
      <div
        class="hit-area"
        @pointerdown=${this._onPointerDown}
        @pointermove=${this._onPointerMove}
        @pointerup=${this._onPointerEnd}
        @pointercancel=${this._onPointerEnd}
      ></div>
      <div class="line"></div>
    `
  }

  private _onPointerDown(event: PointerEvent): void {
    // Only a primary mouse button starts a drag; touch/pen contacts have
    // no meaningful "button" and should always start one.
    if (event.pointerType === 'mouse' && event.button !== 0) return
    const target = event.currentTarget as HTMLElement
    target.setPointerCapture(event.pointerId)
    this.activePointerId = event.pointerId
    this.classList.add('active')
    event.preventDefault()
  }

  private _onPointerMove(event: PointerEvent): void {
    if (this.activePointerId !== event.pointerId) return
    this.dispatchEvent(
      new CustomEvent('splitter-move', {
        detail: { clientX: event.clientX, clientY: event.clientY },
        bubbles: true,
        composed: true,
      }),
    )
  }

  private _onPointerEnd(event: PointerEvent): void {
    if (this.activePointerId !== event.pointerId) return
    this.activePointerId = null
    this.classList.remove('active')
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'layout-splitter': LayoutSplitter
  }
}

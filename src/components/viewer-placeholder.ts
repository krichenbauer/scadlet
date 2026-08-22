import { LitElement, css, html } from 'lit'
import { customElement } from 'lit/decorators.js'

/**
 * Empty placeholder for the future Three.js 3D viewer (Milestone 2).
 */
@customElement('viewer-placeholder')
export class ViewerPlaceholder extends LitElement {
  static styles = css`
    :host {
      display: flex;
      align-items: center;
      justify-content: center;
      text-align: center;
      padding: 16px;
      color: #888;
      font-size: 13px;
    }
  `

  render() {
    return html`<p>3D viewer — coming soon</p>`
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'viewer-placeholder': ViewerPlaceholder
  }
}

import { html, type TemplateResult } from 'lit'

/** Small local SVG vocabulary for compact shell controls. Keeping these inline
 * avoids an icon dependency and ships no external assets. */
export type CompactIconName = 'plus' | 'copy' | 'trash' | 'sort-alpha' | 'clock'

export function compactIcon(name: CompactIconName): TemplateResult {
  const paths: Record<CompactIconName, string> = {
    plus: 'M12 5v14M5 12h14',
    copy: 'M9 8h10v11H9zM5 16H4V5h11v1',
    trash: 'M5 7h14M9 7V4h6v3M8 7l1 13h6l1-13M11 11v5M13 11v5',
    'sort-alpha': 'M5 5h8M5 10h6M5 15h4M17 5v14M14 16l3 3 3-3',
    clock: 'M12 5a7 7 0 1 1 0 14 7 7 0 0 1 0-14ZM12 8v4l3 2',
  }
  return html`<svg viewBox="0 0 24 24" aria-hidden="true"><path d=${paths[name]} /></svg>`
}

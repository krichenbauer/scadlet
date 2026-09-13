import { html, type TemplateResult } from 'lit'

/** Small local SVG vocabulary for compact shell controls. Keeping these inline
 * avoids an icon dependency and ships no external assets. */
export type CompactIconName =
  | 'plus' | 'copy' | 'trash' | 'sort-alpha' | 'clock' | 'chevron-up' | 'chevron-down'
  // Node-family/header icons (node-style.md "Icons in nodes and palette").
  | 'cube' | 'cylinder' | 'sphere'
  | 'translate' | 'rotate' | 'scale'
  | 'union' | 'difference' | 'intersection'
  | 'value' | 'compare' | 'math' | 'conditional'
  | 'module' | 'function' | 'input-port' | 'output-port'
  | 'menu' | 'pencil' | 'eye'

const paths: Record<CompactIconName, string> = {
  plus: 'M12 5v14M5 12h14',
  copy: 'M9 8h10v11H9zM5 16H4V5h11v1',
  trash: 'M5 7h14M9 7V4h6v3M8 7l1 13h6l1-13M11 11v5M13 11v5',
  'sort-alpha': 'M5 5h8M5 10h6M5 15h4M17 5v14M14 16l3 3 3-3',
  clock: 'M12 5a7 7 0 1 1 0 14 7 7 0 0 1 0-14ZM12 8v4l3 2',
  'chevron-up': 'm6 15 6-6 6 6',
  'chevron-down': 'm6 9 6 6 6-6',
  cube: 'M4 7l8-4 8 4-8 4-8-4ZM4 7v10l8 4 8-4V7M12 11v10',
  cylinder: 'M4 6a8 3 0 1 0 16 0a8 3 0 1 0-16 0M4 6v12a8 3 0 0 0 16 0V6',
  sphere: 'M12 3a9 9 0 1 0 0.01 0M3 12h18M12 3c3 3 3 15 0 18c-3-3-3-15 0-18',
  translate: 'M12 2v20M2 12h20M12 2l-3 4M12 2l3 4M12 22l-3-4M12 22l3-4M2 12l4-3M2 12l4 3M22 12l-4-3M22 12l-4 3',
  rotate: 'M20 12a8 8 0 1 1-2.34-5.66M20 4v5h-5',
  scale: 'M4 20l6-6M4 20v-5M4 20h5M20 4l-6 6M20 4v5M20 4h-5',
  union: 'M4 12a5 5 0 1 0 10 0a5 5 0 1 0-10 0M10 12a5 5 0 1 0 10 0a5 5 0 1 0-10 0',
  difference: 'M5 12a6 6 0 1 0 12 0a6 6 0 1 0-12 0M13 8a4 4 0 1 1 0 8a4 4 0 1 1 0-8',
  intersection: 'M4 12a5 5 0 1 0 10 0a5 5 0 1 0-10 0M10 12a5 5 0 1 0 10 0a5 5 0 1 0-10 0M12 12h.01',
  value: 'M9 4l-2 16M17 4l-2 16M4 9h16M3 15h16',
  compare: 'M9 5l-5 7 5 7M15 5l5 7-5 7',
  math: 'M5 3h14v18H5ZM8 7h8M8 11h2M12 11h2M16 11h2M8 15h2M12 15h2M16 15h2',
  conditional: 'M6 4v6a4 4 0 0 0 4 4h4a4 4 0 0 0 4-4V4M6 4a2 2 0 1 0 0.01 0M18 4a2 2 0 1 0 0.01 0M12 14v6M12 20a2 2 0 1 0 0.01 0',
  module: 'M4 4h16v16H4ZM8 8h8v8H8Z',
  function: 'M9 20v-9a4 4 0 0 1 4-4h2M7 11h6',
  'input-port': 'M3 12h11M10 7l4 5-4 5M15 4h6v16h-6',
  'output-port': 'M21 12H10M14 7l-4 5 4 5M9 4H3v16h6',
  menu: 'M4 7h16M4 12h16M4 17h16',
  pencil: 'M4 20l1-4 10-10 3 3-10 10-4 1ZM14 6l3 3',
  eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7ZM12 9a3 3 0 1 0 0.01 0',
}

export function compactIconPath(name: CompactIconName): string {
  return paths[name]
}

export function compactIcon(name: CompactIconName): TemplateResult {
  return html`<svg viewBox="0 0 24 24" aria-hidden="true"><path d=${paths[name]} /></svg>`
}

/** Plain-DOM counterpart used by the custom Rete renderer. */
export function compactIconElement(name: CompactIconName): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('viewBox', '0 0 24 24')
  svg.setAttribute('aria-hidden', 'true')
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
  path.setAttribute('d', paths[name])
  svg.appendChild(path)
  return svg
}

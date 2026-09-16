import { html, svg, type TemplateResult } from 'lit'

/** Small local SVG vocabulary for compact shell controls. Keeping these inline
 * avoids an icon dependency and ships no external assets. */
export type CompactIconName =
  | 'plus' | 'copy' | 'trash' | 'sort-alpha' | 'clock' | 'chevron-up' | 'chevron-down'
  // Node-family/header icons (node-style.md "Icons in nodes and palette").
  | 'cube' | 'cylinder' | 'sphere'
  | 'translate' | 'rotate' | 'scale'
  | 'union' | 'difference' | 'intersection'
  | 'value' | 'compare' | 'math' | 'conditional'
  | 'settings'
  | 'module' | 'function' | 'input-port' | 'output-port'
  | 'menu' | 'pencil' | 'eye' | 'reference'

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
  // The Boolean operations render through BOOLEAN_OPERATION_ICON_PARTS below.
  // These result outlines retain compactIconPath()'s total lookup contract.
  union: 'M3 12a6 6 0 1 0 12 0a6 6 0 1 0-12 0M9 12a6 6 0 1 0 12 0a6 6 0 1 0-12 0',
  difference: 'M12 6.804A6 6 0 1 0 12 17.196A6 6 0 0 1 12 6.804Z',
  intersection: 'M12 6.804A6 6 0 0 1 12 17.196A6 6 0 0 1 12 6.804Z',
  value: 'M9 4l-2 16M17 4l-2 16M4 9h16M3 15h16',
  compare: 'M9 5l-5 7 5 7M15 5l5 7-5 7',
  math: 'M5 3h14v18H5ZM8 7h8M8 11h2M12 11h2M16 11h2M8 15h2M12 15h2M16 15h2',
  conditional: 'M6 4v6a4 4 0 0 0 4 4h4a4 4 0 0 0 4-4V4M6 4a2 2 0 1 0 0.01 0M18 4a2 2 0 1 0 0.01 0M12 14v6M12 20a2 2 0 1 0 0.01 0',
  settings: 'M4 7h10M18 7h2M4 12h2M10 12h10M4 17h7M15 17h5M14 4v6M6 9v6M11 14v6',
  module: 'M4 4h16v16H4ZM8 8h8v8H8Z',
  function: 'M9 20v-9a4 4 0 0 1 4-4h2M7 11h6',
  'input-port': 'M3 12h11M10 7l4 5-4 5M15 4h6v16h-6',
  'output-port': 'M21 12H10M14 7l-4 5 4 5M9 4H3v16h6',
  menu: 'M4 7h16M4 12h16M4 17h16',
  pencil: 'M4 20l1-4 10-10 3 3-10 10-4 1ZM14 6l3 3',
  eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7ZM12 9a3 3 0 1 0 0.01 0',
  reference: 'M4 7h9v10H4zM13 12h7M17 8l4 4-4 4',
}

type BooleanOperationIconName = Extract<CompactIconName, 'union' | 'difference' | 'intersection'>
type BooleanOperationIconPart =
  | { readonly tag: 'circle'; readonly className: 'boolean-operation-icon__input' | 'boolean-operation-icon__result'; readonly fill: '#8f8f8f' | '#f2f2f2'; readonly cx: number; readonly cy: number; readonly r: number }
  | { readonly tag: 'path'; readonly className: 'boolean-operation-icon__result'; readonly fill: '#f2f2f2'; readonly d: string }

/**
 * The Boolean icons show their operands as subdued circles and overlay the
 * Boolean result brightly. Keeping this as data lets Lit and the Rete DOM
 * renderer produce the identical local SVG structure.
 */
const BOOLEAN_OPERATION_ICON_PARTS: Readonly<Record<BooleanOperationIconName, readonly BooleanOperationIconPart[]>> = {
  union: [
    { tag: 'circle', className: 'boolean-operation-icon__result', fill: '#f2f2f2', cx: 9, cy: 12, r: 6 },
    { tag: 'circle', className: 'boolean-operation-icon__result', fill: '#f2f2f2', cx: 15, cy: 12, r: 6 },
  ],
  intersection: [
    { tag: 'circle', className: 'boolean-operation-icon__input', fill: '#8f8f8f', cx: 9, cy: 12, r: 6 },
    { tag: 'circle', className: 'boolean-operation-icon__input', fill: '#8f8f8f', cx: 15, cy: 12, r: 6 },
    { tag: 'path', className: 'boolean-operation-icon__result', fill: '#f2f2f2', d: paths.intersection },
  ],
  difference: [
    { tag: 'circle', className: 'boolean-operation-icon__input', fill: '#8f8f8f', cx: 9, cy: 12, r: 6 },
    { tag: 'circle', className: 'boolean-operation-icon__input', fill: '#8f8f8f', cx: 15, cy: 12, r: 6 },
    { tag: 'path', className: 'boolean-operation-icon__result', fill: '#f2f2f2', d: paths.difference },
  ],
}

function isBooleanOperationIcon(name: CompactIconName): name is BooleanOperationIconName {
  return name === 'union' || name === 'intersection' || name === 'difference'
}

/** Testable icon data for the filled Boolean-result visual contract. */
export function booleanOperationIconParts(name: BooleanOperationIconName): readonly BooleanOperationIconPart[] {
  return BOOLEAN_OPERATION_ICON_PARTS[name]
}

export function compactIconPath(name: CompactIconName): string {
  return paths[name]
}

export function compactIcon(name: CompactIconName): TemplateResult {
  if (isBooleanOperationIcon(name)) {
    return html`<svg class="boolean-operation-icon boolean-operation-icon--${name}" viewBox="0 0 24 24" aria-hidden="true">
      ${BOOLEAN_OPERATION_ICON_PARTS[name].map((part) => part.tag === 'circle'
        ? svg`<circle class=${part.className} fill=${part.fill} style="fill: ${part.fill}; stroke: none" cx=${part.cx} cy=${part.cy} r=${part.r} />`
        : svg`<path class=${part.className} fill=${part.fill} style="fill: ${part.fill}; stroke: none" d=${part.d} />`)}
    </svg>`
  }
  return html`<svg viewBox="0 0 24 24" aria-hidden="true"><path d=${paths[name]} /></svg>`
}

/** Plain-DOM counterpart used by the custom Rete renderer. */
export function compactIconElement(name: CompactIconName): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('viewBox', '0 0 24 24')
  svg.setAttribute('aria-hidden', 'true')
  if (isBooleanOperationIcon(name)) {
    svg.classList.add('boolean-operation-icon', `boolean-operation-icon--${name}`)
    for (const part of BOOLEAN_OPERATION_ICON_PARTS[name]) {
      const shape = document.createElementNS('http://www.w3.org/2000/svg', part.tag)
      shape.setAttribute('class', part.className)
      shape.setAttribute('fill', part.fill)
      shape.style.setProperty('fill', part.fill)
      shape.style.setProperty('stroke', 'none')
      if (part.tag === 'circle') {
        shape.setAttribute('cx', String(part.cx))
        shape.setAttribute('cy', String(part.cy))
        shape.setAttribute('r', String(part.r))
      } else {
        shape.setAttribute('d', part.d)
      }
      svg.appendChild(shape)
    }
    return svg
  }
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
  path.setAttribute('d', paths[name])
  svg.appendChild(path)
  return svg
}

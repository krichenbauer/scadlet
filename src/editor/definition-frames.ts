import type { AreaPlugin } from 'rete-area-plugin'

import { t } from '../i18n/translate'
import type { AreaExtra, Schemes } from './schemes'
import type { DefinitionRegistry } from './definitions'

const NODE_WIDTH = 160
const NODE_HEIGHT = 56
const PADDING = { left: 42, top: 46, right: 42, bottom: 38 }

export interface DefinitionFrameInteractions {
  select(definitionId: string): Promise<void>
  translateSelected(dx: number, dy: number): Promise<void>
  scopeTransferState?(definitionId: string): 'valid' | 'invalid' | null
  /** During an ordinary scope-transfer drag, the source frame stays at its
   * start-of-drag bounds. This keeps its presentation and hit area stable
   * while Rete moves the member nodes underneath it. */
  scopeTransferFrameBounds?(definitionId: string): DefinitionFrameBounds | null
}

export interface DefinitionFrameBounds {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

/** Uses explicit registry ownership and graph positions only. Kept shared by
 * drawing and creation-time drop targeting so both describe the same visible
 * frame without ever turning geometry into ongoing scope inference. */
export function definitionFrameBounds(
  registry: DefinitionRegistry,
  definitionId: string,
  getPosition: (nodeId: string) => { x: number; y: number } | undefined,
  excludedNodeIds: ReadonlySet<string> = new Set(),
): DefinitionFrameBounds | null {
  const positions = registry.nodeIds(definitionId)
    .filter((nodeId) => !excludedNodeIds.has(nodeId))
    .map(getPosition)
    .filter((position): position is { x: number; y: number } => Boolean(position))
  if (positions.length === 0) return null
  return {
    minX: Math.min(...positions.map((position) => position.x)) - PADDING.left,
    minY: Math.min(...positions.map((position) => position.y)) - PADDING.top,
    maxX: Math.max(...positions.map((position) => position.x + NODE_WIDTH)) + PADDING.right,
    maxY: Math.max(...positions.map((position) => position.y + NODE_HEIGHT)) + PADDING.bottom,
  }
}

/** A lightweight same-canvas projection of definition ownership. Frames never
 * decide scope membership: their bounds are recomputed from registry-owned
 * interface-node positions whenever the area changes. */
export function attachDefinitionFrames(
  area: AreaPlugin<Schemes, AreaExtra>,
  registry: DefinitionRegistry,
  interactions: DefinitionFrameInteractions,
): () => void {
  const layer = document.createElement('div')
  layer.className = 'definition-frame-layer'
  area.container.prepend(layer)
  let scheduled = false

  const render = (): void => {
    scheduled = false
    layer.replaceChildren()
    const transform = area.area.transform
    for (const definition of registry.list()) {
      const bounds = interactions.scopeTransferFrameBounds?.(definition.id)
        ?? definitionFrameBounds(registry, definition.id, (id) => area.nodeViews.get(id)?.position)
      if (!bounds) continue
      const frame = document.createElement('section')
      frame.className = 'definition-frame'
      const scopeTransferState = interactions.scopeTransferState?.(definition.id)
      if (scopeTransferState) frame.classList.add(`definition-frame--scope-${scopeTransferState}`)
      frame.dataset.definitionId = definition.id
      frame.setAttribute('role', 'group')
      const frameLabel = definition.kind === 'function' ? t('definition.functionFrame') : t('definition.moduleFrame')
      frame.setAttribute('aria-label', `${frameLabel} ${definition.name}`)
      frame.style.left = `${bounds.minX * transform.k + transform.x}px`
      frame.style.top = `${bounds.minY * transform.k + transform.y}px`
      frame.style.width = `${(bounds.maxX - bounds.minX) * transform.k}px`
      frame.style.height = `${(bounds.maxY - bounds.minY) * transform.k}px`
      const heading = document.createElement('div')
      heading.className = 'definition-frame-title'
      heading.textContent = definition.kind === 'function' ? `function ${definition.name}(...)` : `module ${definition.name}`
      heading.tabIndex = 0
      heading.setAttribute('role', 'button')
      heading.setAttribute('aria-label', `${frameLabel} ${definition.name}`)
      attachHeaderInteraction(heading, definition.id, area, interactions)
      frame.appendChild(heading)
      layer.appendChild(frame)
    }
  }
  const schedule = (): void => {
    if (scheduled) return
    scheduled = true
    requestAnimationFrame(render)
  }
  const unsubscribe = registry.subscribe(schedule)
  area.addPipe((context) => {
    schedule()
    return context
  })
  schedule()
  return () => {
    unsubscribe()
    layer.remove()
  }
}

/** Header gestures deliberately select and translate semantic members via
 * Rete. The frame stays presentation-only: it neither owns coordinates nor
 * decides which nodes belong to the definition. */
function attachHeaderInteraction(
  header: HTMLElement,
  definitionId: string,
  area: AreaPlugin<Schemes, AreaExtra>,
  interactions: DefinitionFrameInteractions,
): void {
  header.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    const start = { x: event.clientX, y: event.clientY }
    let previous = start
    let active = true

    const release = (): void => {
      active = false
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', release)
      window.removeEventListener('pointercancel', release)
    }
    const move = (moveEvent: PointerEvent): void => {
      if (!active) return
      const deltaX = (moveEvent.clientX - previous.x) / area.area.transform.k
      const deltaY = (moveEvent.clientY - previous.y) / area.area.transform.k
      previous = { x: moveEvent.clientX, y: moveEvent.clientY }
      if (deltaX !== 0 || deltaY !== 0) void interactions.translateSelected(deltaX, deltaY)
    }

    // Selection completes before drag listeners are installed, ensuring the
    // translation uses the same selected-node set Rete uses for group drag.
    void interactions.select(definitionId).then(() => {
      if (!active) return
      window.addEventListener('pointermove', move)
      window.addEventListener('pointerup', release)
      window.addEventListener('pointercancel', release)
    })
  })
  header.addEventListener('dblclick', (event) => {
    event.preventDefault()
    event.stopPropagation()
  })
}

import type { AreaPlugin } from 'rete-area-plugin'

import { t } from '../i18n/translate'
import type { AreaExtra, Schemes } from './schemes'
import type { DefinitionRegistry } from './definitions'

const NODE_WIDTH = 160
const NODE_HEIGHT = 56
const PADDING = { left: 42, top: 46, right: 42, bottom: 38 }

/** A lightweight same-canvas projection of definition ownership. Frames never
 * decide scope membership: their bounds are recomputed from registry-owned
 * interface-node positions whenever the area changes. */
export function attachDefinitionFrames(
  area: AreaPlugin<Schemes, AreaExtra>,
  registry: DefinitionRegistry,
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
      const positions = [definition.inputsNodeId, definition.outputNodeId]
        .map((id) => area.nodeViews.get(id)?.position)
        .filter((position): position is { x: number; y: number } => Boolean(position))
      if (positions.length === 0) continue
      const minX = Math.min(...positions.map((position) => position.x)) - PADDING.left
      const minY = Math.min(...positions.map((position) => position.y)) - PADDING.top
      const maxX = Math.max(...positions.map((position) => position.x + NODE_WIDTH)) + PADDING.right
      const maxY = Math.max(...positions.map((position) => position.y + NODE_HEIGHT)) + PADDING.bottom
      const frame = document.createElement('section')
      frame.className = 'definition-frame'
      frame.dataset.definitionId = definition.id
      frame.setAttribute('role', 'group')
      frame.setAttribute('aria-label', `${t('definition.moduleFrame')} ${definition.name}`)
      frame.style.left = `${minX * transform.k + transform.x}px`
      frame.style.top = `${minY * transform.k + transform.y}px`
      frame.style.width = `${(maxX - minX) * transform.k}px`
      frame.style.height = `${(maxY - minY) * transform.k}px`
      const heading = document.createElement('div')
      heading.className = 'definition-frame-title'
      heading.textContent = `module ${definition.name}`
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

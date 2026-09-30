import { readFileSync } from 'node:fs'
import { expect, test, type Page } from './fixtures'
import { waitForAutosave } from './support'

async function waitForLocalLibrary(page: Page): Promise<void> {
  await page.goto('/')
  await expect(page.locator('scadlet-app .project-name')).toBeEnabled()
}

test('every ordinary palette node exposes the shared accessible tooltip', async ({ page }) => {
  await waitForLocalLibrary(page)
  const palette = page.locator('node-palette')
  const entries = palette.locator('.node-item[data-node-type]')
  await expect(entries).toHaveCount(26)

  expect(await entries.evaluateAll((items) => items.map((item) => item.getAttribute('data-node-type')))).toEqual([
    'cube', 'cylinder', 'sphere',
    'translate', 'rotate', 'scale', 'mirror', 'resize',
    'difference', 'union', 'intersection',
    'for', 'if',
    'scad-settings',
    'number', 'boolean', 'vector3', 'pi',
    'arithmetic', 'trigonometry', 'basic-math', 'vector-math', 'min-max', 'exponential-log', 'compare', 'conditional',
  ])
  for (const entry of await entries.all()) {
    await expect(entry).toHaveAttribute('tabindex', '0')
    await expect(entry).toHaveAttribute('aria-describedby', 'node-palette-tooltip')
  }
  for (const select of await palette.locator('.node-item--operation select').all()) {
    await expect(select).toHaveAttribute('aria-describedby', 'node-palette-tooltip')
  }

  const tooltip = palette.locator('#node-palette-tooltip')
  await expect(tooltip).toHaveCount(1)
  await expect(tooltip).toHaveAttribute('role', 'tooltip')
  await expect(tooltip).toHaveAttribute('popover', 'manual')
  await expect(tooltip).toBeHidden()
})

test('new typed value operations are available in the palette with one Vector Math and one Min / Max entry', async ({ page }) => {
  await waitForLocalLibrary(page)
  const palette = page.locator('node-palette')
  for (const type of ['pi', 'vector-math', 'min-max']) {
    await expect(palette.locator(`.node-item[data-node-type="${type}"]`)).toHaveCount(1)
  }
  await expect(palette.locator('.node-item[data-node-type="vector-math"] select option')).toHaveText([
    'Add', 'Subtract', 'Scale', 'Divide', 'Dot product', 'Cross product', 'Norm', 'Negate',
  ])
  await expect(palette.locator('.node-item[data-node-type="min-max"] select option')).toHaveText(['Minimum', 'Maximum'])
  const pi = palette.locator('.node-item[data-node-type="pi"]')
  await expect(pi).toHaveAccessibleName('PI, mathematical constant pi')
  await pi.focus()
  await expect(pi).toHaveAccessibleDescription(/mathematical constant pi/)
})

test('creates PI, Vector Math, and dynamic Min / Max nodes and switches Vector Math sockets', async ({ page }) => {
  await waitForLocalLibrary(page)
  const editor = page.locator('node-editor')
  const bounds = await editor.boundingBox()
  if (!bounds) throw new Error('Expected visible graph canvas')
  for (const [type, x, y] of [['pi', 0.35, 0.35], ['vector-math', 0.55, 0.4], ['min-max', 0.75, 0.45]] as const) {
    const point = { x: bounds.x + bounds.width * x, y: bounds.y + bounds.height * y }
    await editor.evaluate((element, payload) => {
      const canvas = element.shadowRoot?.querySelector('#canvas')
      if (!canvas) throw new Error('Expected graph canvas target')
      const dataTransfer = new DataTransfer()
      dataTransfer.setData('application/x-scadlet-node-type', payload.type)
      canvas.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, clientX: payload.x, clientY: payload.y, dataTransfer }))
      canvas.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, clientX: payload.x, clientY: payload.y, dataTransfer }))
    }, { type, ...point })
  }
  const vector = page.locator('node-editor .node').filter({ has: page.locator('select option[value="add"]') })
  const minMax = page.locator('node-editor .node').filter({ has: page.locator('select option[value="minimum"]') })
  await expect(page.locator('node-editor .node').filter({ hasText: 'PI' })).toHaveCount(1)
  await expect(vector.locator('select')).toHaveValue('add')
  await expect(vector).toContainText('A')
  await expect(vector).toContainText('B')
  await vector.locator('select').selectOption('scale')
  await expect(vector).toContainText('Vector')
  await expect(vector).toContainText('Factor')
  await expect(minMax.locator('select')).toHaveValue('minimum')
  await expect(minMax).toContainText('A')
  await expect(minMax).toContainText('B')
  await expect(minMax).toContainText('Operand')
  const operandInputs = minMax.locator('input[type="number"]')
  await expect(operandInputs).toHaveCount(3)
  await operandInputs.nth(2).fill('7')
  await expect(minMax.locator('input[type="number"]')).toHaveCount(4)
})

test('PI and Min / Max feed live OpenSCAD preview, Inspect, export, and save/reload', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('scadlet-app .project-name')).toBeEnabled()
  const projectId = 'typed-value-operations-e2e'
  const project = {
    format: 'scadlet', version: 8, metadata: { name: 'Typed value operations' }, definitions: [],
    graph: {
      nodes: [
        { id: 'pi', type: 'pi', position: { x: 0, y: 0 }, parameters: {} },
        { id: 'two', type: 'number', position: { x: 0, y: 180 }, parameters: { value: 2, name: 'Two' } },
        { id: 'minimum', type: 'min-max', position: { x: 250, y: 90 }, parameters: { operation: 'minimum', operands: [{ id: 'a', value: 0 }, { id: 'b', value: 0 }, { id: 'tail' }] } },
        { id: 'cube', type: 'cube', position: { x: 520, y: 90 }, parameters: { sizeRepresentation: 'scalar', size: 10, sizeScalar: 10, sizeVector: { x: 10, y: 10, z: 10 } } },
      ],
      connections: [
        { id: 'pi-minimum', source: 'pi', sourceOutput: 'value', target: 'minimum', targetInput: 'a' },
        { id: 'two-minimum', source: 'two', sourceOutput: 'value', target: 'minimum', targetInput: 'b' },
        { id: 'minimum-cube', source: 'minimum', sourceOutput: 'value', target: 'cube', targetInput: 'size' },
      ],
    },
    editor: { viewport: { x: 0, y: 0, zoom: 1 } },
    viewer: { camera: { position: [80, 80, 60], target: [0, 0, 0] } },
  }
  await page.evaluate(async ({ projectRecord, activeId }) => {
    const request = indexedDB.open('scadlet-projects')
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    const transaction = database.transaction('projects', 'readwrite')
    transaction.objectStore('projects').clear()
    transaction.objectStore('projects').put({ id: activeId, revision: 1, createdAt: '', updatedAt: '', project: projectRecord })
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
      transaction.onabort = () => reject(transaction.error)
    })
    database.close()
    sessionStorage.setItem('scadlet.activeProjectId', activeId)
  }, { projectRecord: project, activeId: projectId })
  await page.reload()
  await expect(page.locator('scadlet-app .project-name')).toHaveValue('Typed value operations')
  const source = page.locator('scadlet-app .scad-output')
  await expect(source).toContainText('cube(min(PI, 2));', { timeout: 15_000 })
  const minimum = page.locator('node-editor .node[data-node-id="minimum"]')
  await minimum.locator('.node-body').dblclick({ position: { x: 2, y: 10 } })
  await expect(minimum.locator('.node-inspect-value')).toHaveText('= 2', { timeout: 15_000 })
  const trigger = page.locator('scadlet-app header').getByRole('button', { name: /^File\b/ })
  if (await trigger.getAttribute('aria-expanded') !== 'true') await trigger.click()
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('menuitem', { name: 'Download .scad', exact: true }).click(),
  ])
  const path = await download.path()
  if (!path) throw new Error('Expected the exported OpenSCAD source file')
  expect(readFileSync(path, 'utf8')).toContain('cube(min(PI, 2));')
  await page.keyboard.press('Escape')
  await page.reload()
  await expect(page.locator('scadlet-app .project-name')).toHaveValue('Typed value operations')
  await expect(page.locator('scadlet-app .scad-output')).toContainText('cube(min(PI, 2));', { timeout: 15_000 })
  await waitForAutosave(page)
})

test('hover and keyboard focus show the same English explanation and cleanly dismiss it', async ({ page }, testInfo) => {
  await waitForLocalLibrary(page)
  const palette = page.locator('node-palette')
  const cube = palette.locator('.node-item[data-node-type="cube"]')
  const tooltip = palette.locator('#node-palette-tooltip')
  const expected = 'Creates a cuboid. Its size and centering can be set through inputs.'

  await cube.hover()
  expect(await tooltip.evaluate((element) => element.matches(':popover-open'))).toBe(false)
  await expect(tooltip).toBeVisible({ timeout: 1_200 })
  await expect(tooltip.locator('.palette-tooltip-title')).toHaveText('Cube')
  await expect(tooltip.locator('.palette-tooltip-description')).toHaveText(expected)
  await expect(cube).toHaveAccessibleDescription(new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))

  const [normalIconSize, tooltipIconSize] = await Promise.all([
    cube.locator('.node-item-icon').evaluate((icon) => ({ width: getComputedStyle(icon).width, height: getComputedStyle(icon).height })),
    tooltip.locator('.palette-tooltip-icon').evaluate((icon) => ({ width: getComputedStyle(icon).width, height: getComputedStyle(icon).height })),
  ])
  expect(normalIconSize).toEqual({ width: '18px', height: '18px' })
  expect(tooltipIconSize).toEqual({ width: '44px', height: '44px' })
  await expect(tooltip).toHaveCSS('pointer-events', 'none')
  await page.screenshot({ path: testInfo.outputPath('palette-tooltip-cube.png') })

  await page.locator('node-editor').hover({ position: { x: 100, y: 100 } })
  await expect(tooltip).toBeHidden()

  await cube.focus()
  await expect(cube).toBeFocused()
  await expect(tooltip).toBeVisible()
  await expect(tooltip.locator('.palette-tooltip-description')).toHaveText(expected)
  await page.keyboard.press('Escape')
  await expect(tooltip).toBeHidden()
  await expect(cube).toBeFocused()

  await page.locator('scadlet-app .project-name').focus()
  await cube.focus()
  await expect(tooltip).toBeVisible()
  const dragPayload = await cube.evaluate((item) => {
    const transfer = new DataTransfer()
    item.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: transfer }))
    return transfer.getData('application/x-scadlet-node-type')
  })
  expect(dragPayload).toBe('cube')
  await expect(tooltip).toBeHidden()
})

test('Math copy names its operations and an edge tooltip stays inside the viewport, outside the palette clip', async ({ page }, testInfo) => {
  await waitForLocalLibrary(page)
  const palette = page.locator('node-palette')
  const trigonometry = palette.locator('.node-item[data-node-type="trigonometry"]')
  const edgeEntry = palette.locator('.node-item[data-node-type="exponential-log"]')
  const tooltip = palette.locator('#node-palette-tooltip')

  await trigonometry.scrollIntoViewIfNeeded()
  await trigonometry.focus()
  await expect(tooltip).toBeVisible()
  await expect(tooltip.locator('.palette-tooltip-description')).toHaveText('Includes sin, cos, tan, asin, acos, atan, and atan2.')

  await page.locator('scadlet-app .project-name').focus()
  await edgeEntry.scrollIntoViewIfNeeded()
  await edgeEntry.hover()
  await expect(tooltip).toBeVisible({ timeout: 1_200 })
  await expect(tooltip.locator('.palette-tooltip-description')).toHaveText('Includes exp, ln, and log.')

  const paletteBox = await palette.boundingBox()
  const tooltipBox = await tooltip.boundingBox()
  const viewport = page.viewportSize()
  if (!paletteBox || !tooltipBox || !viewport) throw new Error('Expected palette, tooltip, and viewport bounds')
  expect(tooltipBox.x).toBeGreaterThanOrEqual(paletteBox.x + paletteBox.width)
  expect(tooltipBox.x).toBeGreaterThanOrEqual(8)
  expect(tooltipBox.y).toBeGreaterThanOrEqual(8)
  expect(tooltipBox.x + tooltipBox.width).toBeLessThanOrEqual(viewport.width - 8)
  expect(tooltipBox.y + tooltipBox.height).toBeLessThanOrEqual(viewport.height - 8)

  await page.screenshot({ path: testInfo.outputPath('palette-tooltip-edge.png') })
})

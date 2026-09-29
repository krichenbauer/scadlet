import { readFileSync } from 'node:fs'
import { expect, test, type Locator, type Page } from './fixtures'
import { waitForAutosave, waitForBoundingBox } from './support'

async function ready(page: Page): Promise<void> {
  await page.goto('/')
  await expect(page.getByRole('textbox', { name: 'Project name' })).toBeEnabled()
}

async function dropPaletteNode(page: Page, type: string, point: { x: number; y: number }): Promise<void> {
  await page.locator('node-editor').evaluate((element, input) => {
    const canvas = element.shadowRoot?.querySelector('#canvas')
    if (!canvas) throw new Error('Expected node-editor canvas')
    const dataTransfer = new DataTransfer()
    dataTransfer.setData('application/x-scadlet-node-type', input.type)
    canvas.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, clientX: input.x, clientY: input.y, dataTransfer }))
    canvas.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, clientX: input.x, clientY: input.y, dataTransfer }))
  }, { type, ...point })
}

async function connect(page: Page, source: Locator, target: Locator): Promise<void> {
  const start = await waitForBoundingBox(source)
  const end = await waitForBoundingBox(target)
  await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2)
  await page.mouse.down()
  await page.mouse.move(end.x + end.width / 2, end.y + end.height / 2, { steps: 8 })
  await page.mouse.up()
}

async function fileAction(page: Page, name: string): Promise<Locator> {
  const trigger = page.locator('scadlet-app header').getByRole('button', { name: /^File\b/ })
  if (await trigger.getAttribute('aria-expanded') !== 'true') await trigger.click()
  return page.getByRole('menuitem', { name, exact: true })
}

async function expectStructuralAnchorBelow(node: Locator, ordinaryRows: Locator): Promise<number> {
  const anchor = node.locator('.node-structural-row .node-structural-anchor')
  const anchorBox = await waitForBoundingBox(anchor)
  const rowBottoms = await ordinaryRows.evaluateAll((rows) => rows.map((row) => {
    const rect = row.getBoundingClientRect()
    return rect.bottom
  }))
  expect(rowBottoms.length).toBeGreaterThan(0)
  expect(anchorBox.y).toBeGreaterThan(Math.max(...rowBottoms))
  expect(await node.evaluate((element) => element.lastElementChild?.classList.contains('node-structural-row'))).toBe(true)
  return anchorBox.y
}

test('For creates an accessible fixed pair, composes a numeric Geometry body, duplicates jointly, and is refused in Functions', async ({ page }) => {
  await ready(page)
  const editor = page.locator('node-editor')
  const canvas = await waitForBoundingBox(editor)

  const paletteEntry = page.locator('node-palette .node-item[data-node-type="for"]')
  await expect(paletteEntry).toContainText('For')
  await paletteEntry.focus()
  await expect(page.locator('node-palette [role="tooltip"]')).toContainText('numeric start, step, and end range')

  await dropPaletteNode(page, 'for', { x: canvas.x + 120, y: canvas.y + 120 })
  const header = editor.locator('.node[data-node-type="for"]')
  const result = editor.locator('.node[data-node-type="for-result"]')
  await expect(header).toHaveCount(1)
  await expect(result).toHaveCount(1)
  const pairId = await header.getAttribute('data-for-pair-id')
  expect(pairId).toBeTruthy()
  await expect(result).toHaveAttribute('data-for-pair-id', pairId!)
  await expect(header).toHaveAttribute('aria-label', /Fixed loop boundary/)
  await expect(result).toHaveAttribute('aria-label', /Fixed loop boundary/)

  for (const [key, value] of [['start', '0'], ['step', '1'], ['end', '10']] as const) {
    const row = header.locator(`.node-param-row[data-param-key="${key}"]`)
    await expect(row.locator('.node-socket')).toHaveAttribute('data-socket-type', 'number')
    await expect(row.locator('input')).toHaveValue(value)
  }
  await expect(header.locator('.node-create-variable-reference')).toHaveAttribute('aria-label', 'Create variable reference')
  await expect(header.locator('.node-structural-anchor')).toHaveCount(1)
  await expect(result.locator('.node-structural-anchor')).toHaveCount(1)
  await expect(header.locator('.node-socket[data-socket-type="structure"]')).toHaveCount(0)
  await expect(result.locator('.node-socket[data-socket-type="structure"]')).toHaveCount(0)
  await expect(header.locator('.node-structural-anchor')).toHaveAttribute('role', 'img')
  await expect(result.locator('.node-structural-anchor')).toHaveAttribute('role', 'img')
  await expect(header.locator('.node-structural-anchor')).toHaveCSS('background-color', 'rgb(58, 58, 58)')
  await expect(result.locator('.node-structural-anchor')).toHaveCSS('border-color', 'rgb(133, 133, 133)')
  await expectStructuralAnchorBelow(header, header.locator('.node-param-row'))
  const initialResultAnchorY = await expectStructuralAnchorBelow(result, result.locator('.node-inputs .node-port'))
  const structural = editor.locator('svg.connection[data-structural-connection="true"]')
  await expect(structural).toHaveCount(1)
  expect(await structural.locator('.connection-path').evaluate((path) => getComputedStyle(path).strokeWidth)).toBe('6px')
  await expect(structural.locator('.connection-path')).toHaveCSS('stroke', 'rgb(133, 133, 133)')
  expect(await structural.evaluate((wire) => getComputedStyle(wire).pointerEvents)).toBe('none')
  await expect(structural.locator('.connection-hit-path')).toHaveCSS('pointer-events', 'none')
  await expect(structural).toHaveAttribute('role', 'img')
  await expect(structural).toHaveAttribute('aria-label', 'Fixed loop boundary')

  const headerBox = await waitForBoundingBox(header)
  const resultBox = await waitForBoundingBox(result)
  expect(resultBox.x - headerBox.x).toBeGreaterThan(250)
  const headerTitle = await waitForBoundingBox(header.locator('.node-title'))
  await page.mouse.move(headerTitle.x + 8, headerTitle.y + 8)
  await page.mouse.down()
  await page.mouse.move(headerTitle.x + 8, headerTitle.y + 68, { steps: 8 })
  await page.mouse.up()
  const movedHeaderBox = await waitForBoundingBox(header)
  const unmovedResultBox = await waitForBoundingBox(result)
  expect(movedHeaderBox.y - headerBox.y).toBeGreaterThan(40)
  expect(Math.abs(unmovedResultBox.y - resultBox.y)).toBeLessThan(2)

  await result.locator('.node-more-summary').click()
  await result.getByRole('menuitem', { name: 'Duplicate', exact: true }).click()
  await expect(editor.locator('.graph-placement-preview-node')).toHaveCount(2)
  await expect(editor.locator('.node[data-node-type="for"]')).toHaveCount(1)
  await page.mouse.click(canvas.x + canvas.width - 90, canvas.y + canvas.height - 90)
  await expect(editor.locator('.node[data-node-type="for"]')).toHaveCount(2)
  await expect(editor.locator('.node[data-node-type="for-result"]')).toHaveCount(2)
  await expect(editor.locator('svg.connection[data-structural-connection="true"]')).toHaveCount(2)
  const duplicateHeader = editor.locator('.node[data-node-type="for"]').nth(1)
  await duplicateHeader.locator('.node-more-summary').click()
  await duplicateHeader.getByRole('menuitem', { name: 'Delete', exact: true }).click()
  await expect(editor.locator('.node[data-node-type="for"]')).toHaveCount(1)
  await expect(editor.locator('.node[data-node-type="for-result"]')).toHaveCount(1)

  await dropPaletteNode(page, 'cube', { x: canvas.x + 170, y: canvas.y + 390 })
  await dropPaletteNode(page, 'translate', { x: canvas.x + 390, y: canvas.y + 390 })
  const cube = editor.locator('.node[data-node-type="cube"]')
  const translate = editor.locator('.node[data-node-type="translate"]')
  await connect(page, cube.locator('.node-port--output .node-socket'), translate.locator('.node-socket[data-socket-side="input"][data-socket-key="geometry"]'))
  await connect(page, translate.locator('.node-port--output .node-socket'), result.locator('.node-socket[data-socket-key^="child:"]'))
  await expect(result.locator('.node-inputs .node-port')).toHaveCount(2)
  const expandedResultAnchorY = await expectStructuralAnchorBelow(result, result.locator('.node-inputs .node-port'))
  expect(expandedResultAnchorY).toBeGreaterThan(initialResultAnchorY)
  await connect(page, header.locator('.node-socket[data-socket-key="value"]'), translate.locator('.node-socket[data-socket-key="x"]'))
  await expect(page.locator('scadlet-app .scad-output')).toContainText('for (i = [0 : 1 : 10])', { timeout: 15_000 })
  await expect(page.locator('scadlet-app .scad-output')).toContainText('translate([i, 0, 0])')

  await header.getByRole('button', { name: 'Create variable reference', exact: true }).click()
  await page.mouse.click(canvas.x + canvas.width - 80, canvas.y + canvas.height - 80)
  const iteratorReference = editor.locator('.node[data-node-type="variable-reference"]')
  await expect(iteratorReference).toHaveCount(1)
  await expect(iteratorReference.locator('.node-title')).toHaveText('i')

  await header.locator('.node-more-summary').click()
  await header.getByRole('menuitem', { name: 'Rename', exact: true }).click()
  await header.locator('input.node-title').fill('index')
  await header.locator('input.node-title').press('Enter')
  await expect(iteratorReference.locator('.node-title')).toHaveText('index')
  const source = page.locator('scadlet-app .scad-output')
  await expect(source).toContainText('for (index = [0 : 1 : 10])', { timeout: 15_000 })
  await expect(source).toContainText('translate([index, 0, 0])')

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    (await fileAction(page, 'Download .scad')).click(),
  ])
  const path = await download.path()
  if (!path) throw new Error('Expected downloaded SCAD path')
  expect(readFileSync(path, 'utf8').trim()).toBe(((await source.textContent()) ?? '').trim())

  await page.getByRole('button', { name: '+ New module', exact: true }).click()
  const moduleDialog = page.getByRole('form', { name: 'Create module' })
  await moduleDialog.getByLabel('Module name').fill('loop_module')
  await moduleDialog.getByRole('button', { name: 'Create', exact: true }).click()
  const moduleFrame = editor.locator('.definition-frame').filter({ hasText: 'loop_module' })
  const moduleBox = await waitForBoundingBox(moduleFrame)
  await dropPaletteNode(page, 'for', { x: moduleBox.x + moduleBox.width / 2, y: moduleBox.y + moduleBox.height / 2 })
  await expect(editor.locator('.node[data-node-type="for"]')).toHaveCount(2)
  await expect(editor.locator('.node[data-node-type="for-result"]')).toHaveCount(2)

  await page.getByRole('button', { name: '+ New function', exact: true }).click()
  const dialog = page.getByRole('form', { name: 'Create function' })
  await dialog.getByLabel('Function name').fill('value_only')
  await dialog.getByRole('button', { name: 'Create', exact: true }).click()
  const functionFrame = editor.locator('.definition-frame').filter({ hasText: 'value_only' })
  const functionBox = await waitForBoundingBox(functionFrame)
  await dropPaletteNode(page, 'for', { x: functionBox.x + functionBox.width / 2, y: functionBox.y + functionBox.height / 2 })
  await expect(editor.locator('.node[data-node-type="for"]')).toHaveCount(2)
  await expect(editor.locator('.editor-feedback')).toContainText('Only value/math and Function Call nodes')

  await waitForAutosave(page)
  await page.reload()
  await expect(page.getByRole('textbox', { name: 'Project name' })).toBeEnabled()
  await expect(editor.locator('.node[data-node-type="for"]')).toHaveCount(2)
  await expect(editor.locator('.node[data-node-type="for-result"]')).toHaveCount(2)
  await expect(editor.locator('svg.connection[data-structural-connection="true"]')).toHaveCount(2)
  await expect(editor.locator('.node[data-node-type="variable-reference"] .node-title')).toHaveText('index')
  await expectStructuralAnchorBelow(editor.locator('.node[data-node-type="for-result"]').first(), editor.locator('.node[data-node-type="for-result"]').first().locator('.node-inputs .node-port'))
  await expect(page.locator('scadlet-app .scad-output')).toContainText('for (index = [0 : 1 : 10])', { timeout: 15_000 })
})

test('a new bodyless For pair stays quiet, exports empty source, restores, and activates when Geometry is connected', async ({ page }) => {
  await ready(page)
  const editor = page.locator('node-editor')
  const canvas = await waitForBoundingBox(editor)
  await dropPaletteNode(page, 'for', { x: canvas.x + 140, y: canvas.y + 140 })

  const header = editor.locator('.node[data-node-type="for"]')
  const result = editor.locator('.node[data-node-type="for-result"]')
  await expect(page.locator('scadlet-app .render-error')).toHaveCount(0)
  await expect(page.locator('geometry-viewer .empty-geometry-status')).toHaveText('Nothing visible to render.', { timeout: 15_000 })

  await page.getByRole('button', { name: 'Render', exact: true }).click()
  await expect(page.locator('scadlet-app .render-error')).toHaveCount(0)
  await expect(page.locator('geometry-viewer .empty-geometry-status')).toHaveText('Nothing visible to render.')

  await result.locator('.node-more-summary').click()
  await result.getByRole('menuitem', { name: 'Inspect', exact: true }).click()
  await expect(page.locator('scadlet-app .render-error')).toHaveCount(0)
  await expect(page.locator('geometry-viewer .empty-geometry-status')).toHaveText('Nothing visible to render.')
  await expect(editor.locator('.node--inspected')).toHaveCount(0)

  const projectName = page.getByRole('textbox', { name: 'Project name' })
  await projectName.fill('Empty For draft')
  await projectName.press('Enter')
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    (await fileAction(page, 'Download .scad')).click(),
  ])
  const path = await download.path()
  if (!path) throw new Error('Expected downloaded SCAD path')
  expect(readFileSync(path, 'utf8')).toBe('')
  await expect(page.locator('scadlet-app .render-error')).toHaveCount(0)

  await dropPaletteNode(page, 'cube', { x: canvas.x + 280, y: canvas.y + 390 })
  const cube = editor.locator('.node[data-node-type="cube"]')
  const initialAnchorY = (await waitForBoundingBox(result.locator('.node-structural-anchor'))).y
  await connect(page, cube.locator('.node-port--output .node-socket'), result.locator('.node-socket[data-socket-key^="child:"]'))
  await expect(page.locator('scadlet-app .scad-output')).toContainText('for (i = [0 : 1 : 10])', { timeout: 15_000 })
  await expect(page.locator('scadlet-app .scad-output')).toContainText('cube();')
  await expect(result.locator('.node-inputs .node-port')).toHaveCount(2)
  expect(await expectStructuralAnchorBelow(result, result.locator('.node-inputs .node-port'))).toBeGreaterThan(initialAnchorY)

  const bodyWire = editor.locator('svg.connection[data-structural-connection="false"] .connection-hit-path')
  await bodyWire.dispatchEvent('pointerdown', { button: 0 })
  await page.keyboard.press('Delete')
  await expect(editor.locator('svg.connection[data-structural-connection="false"]')).toHaveCount(0)
  await expect(page.locator('scadlet-app .render-error')).toHaveCount(0)
  await expect(page.locator('scadlet-app .scad-output')).not.toContainText('for (')
  await expect(page.locator('scadlet-app .scad-output')).toContainText('cube();', { timeout: 15_000 })
  await expectStructuralAnchorBelow(result, result.locator('.node-inputs .node-port'))

  await cube.locator('.node-more-summary').click()
  await cube.getByRole('menuitem', { name: 'Delete', exact: true }).click()
  await expect(cube).toHaveCount(0)
  await expect(page.locator('geometry-viewer .empty-geometry-status')).toHaveText('Nothing visible to render.', { timeout: 15_000 })

  await waitForAutosave(page)
  await page.reload()
  await expect(page.getByRole('textbox', { name: 'Project name' })).toBeEnabled()
  await expect(editor.locator('.node[data-node-type="for"]')).toHaveCount(1)
  const restoredResult = editor.locator('.node[data-node-type="for-result"]')
  await expect(restoredResult.locator('.node-inputs .node-port')).toHaveCount(2)
  await expectStructuralAnchorBelow(restoredResult, restoredResult.locator('.node-inputs .node-port'))
  await expect(page.locator('scadlet-app .render-error')).toHaveCount(0)
  await expect(page.locator('geometry-viewer .empty-geometry-status')).toHaveText('Nothing visible to render.', { timeout: 15_000 })
  await expect(header).toHaveCount(1)
})

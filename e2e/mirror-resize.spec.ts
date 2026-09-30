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

async function addParameter(node: Locator, label: string): Promise<void> {
  await node.locator('.node-add-summary').click()
  await node.locator('.node-add-options').getByRole('button', { name: label, exact: true }).click()
}

async function viewerHasMesh(page: Page): Promise<boolean> {
  return page.locator('geometry-viewer').evaluate((viewer) => Boolean((viewer as unknown as { mesh?: unknown }).mesh))
}

test('Mirror and Resize start argument-less, add useful forms, render through OpenSCAD-WASM, export, and restore', async ({ page }) => {
  await ready(page)
  const palette = page.locator('node-palette')
  for (const [type, label] of [['mirror', 'Mirror'], ['resize', 'Resize']] as const) {
    const entry = palette.locator(`.node-item[data-node-type="${type}"]`)
    await expect(entry).toContainText(label)
    await expect(entry).toHaveClass(/node-item--geometry-output/)
    await expect(entry.locator('svg')).toHaveCount(1)
  }
  await palette.locator('.node-item[data-node-type="resize"]').focus()
  await expect(page.locator('node-palette [role="tooltip"]')).toContainText('An axis set to 0 keeps its size')

  const editor = page.locator('node-editor')
  const canvas = await waitForBoundingBox(editor)
  await dropPaletteNode(page, 'cube', { x: canvas.x + 30, y: canvas.y + 40 })
  await dropPaletteNode(page, 'mirror', { x: canvas.x + 30, y: canvas.y + 200 })
  await dropPaletteNode(page, 'resize', { x: canvas.x + 300, y: canvas.y + 200 })
  const cube = editor.locator('.node[data-node-type="cube"]')
  const mirror = editor.locator('.node[data-node-type="mirror"]')
  const resize = editor.locator('.node[data-node-type="resize"]')
  for (const node of [mirror, resize]) {
    await expect(node).toHaveClass(/node--geometry-output/)
    await expect(node.locator('.node-param-row')).toHaveCount(0)
  }

  const wires = editor.locator('.connection[data-real-connection="true"]')
  await connect(page, cube.locator('.node-port--output .node-socket'), mirror.locator('.node-socket[data-socket-side="input"][data-socket-key="geometry"]'))
  await expect(wires).toHaveCount(1)
  await connect(page, mirror.locator('.node-port--output .node-socket'), resize.locator('.node-socket[data-socket-side="input"][data-socket-key="geometry"]'))
  await expect(wires).toHaveCount(2)
  const source = page.locator('scadlet-app .scad-output')
  // Without added parameters both nodes emit OpenSCAD's argument-less calls.
  await expect(source).toContainText('resize() {\n    mirror() {\n        cube();', { timeout: 15_000 })

  await addParameter(mirror, 'XYZ')
  await expect(mirror.locator('.node-param-row[data-param-key="x"] input')).toHaveValue('1')
  await addParameter(resize, 'XYZ')
  await expect(resize.locator('.node-param-row[data-param-key="x"] input')).toHaveValue('10')
  await addParameter(resize, 'Keep proportions')
  await expect(resize.locator('.node-param-row[data-param-key="auto"] input[type="checkbox"]')).toBeChecked()
  await expect(resize.locator('.node-add-summary')).toHaveAttribute('aria-disabled', 'true')
  await resize.locator('.node-param-row[data-param-key="x"] input').fill('20')
  await resize.locator('.node-param-row[data-param-key="y"] input').fill('0')
  await resize.locator('.node-param-row[data-param-key="z"] input').fill('0')

  await expect(source).toContainText('resize([20, 0, 0], auto=true) {\n    mirror([1, 0, 0]) {\n        cube();', { timeout: 15_000 })
  await expect.poll(() => viewerHasMesh(page), { timeout: 15_000 }).toBe(true)
  await expect(page.locator('scadlet-app .render-error')).toHaveCount(0)

  const fileTrigger = page.locator('scadlet-app header').getByRole('button', { name: /^File\b/ })
  await fileTrigger.click()
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('menuitem', { name: 'Download .scad', exact: true }).click(),
  ])
  const path = await download.path()
  if (!path) throw new Error('Expected downloaded SCAD path')
  expect(readFileSync(path, 'utf8').trim()).toBe(((await source.textContent()) ?? '').trim())

  await waitForAutosave(page)
  await page.reload()
  await expect(page.getByRole('textbox', { name: 'Project name' })).toBeEnabled()
  await expect(editor.locator('.node[data-node-type="resize"] .node-param-row[data-param-key="auto"] input[type="checkbox"]')).toBeChecked()
  await expect(page.locator('scadlet-app .scad-output')).toContainText('resize([20, 0, 0], auto=true) {\n    mirror([1, 0, 0])', { timeout: 15_000 })
})

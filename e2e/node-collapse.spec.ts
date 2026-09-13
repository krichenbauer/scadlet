import { expect, test, type Locator, type Page } from '@playwright/test'

async function dropPaletteNode(page: Page, type: string, point: { x: number; y: number }): Promise<void> {
  await page.locator('node-editor').evaluate((element, { type, x, y }) => {
    const canvas = element.shadowRoot?.querySelector('#canvas')
    if (!canvas) throw new Error('Expected node-editor canvas')
    const dataTransfer = new DataTransfer()
    dataTransfer.setData('application/x-scadlet-node-type', type)
    canvas.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, clientX: x, clientY: y, dataTransfer }))
    canvas.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, clientX: x, clientY: y, dataTransfer }))
  }, { type, ...point })
}

async function node(page: Page, title: string): Promise<Locator> {
  const result = page.locator('node-editor .node').filter({ has: page.locator('.node-title', { hasText: title }) })
  await expect(result).toHaveCount(1)
  return result
}

async function connect(page: Page, source: Locator, target: Locator): Promise<void> {
  const sourceBox = await source.boundingBox()
  const targetBox = await target.boundingBox()
  if (!sourceBox || !targetBox) throw new Error('Expected visible sockets')
  await page.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2)
  await page.mouse.down()
  await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height / 2, { steps: 8 })
  await page.mouse.up()
}

test('explicit node collapse persists without changing wires or wire gestures', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('textbox', { name: 'Project name' })).toBeEnabled()
  await dropPaletteNode(page, 'cube', { x: 160, y: 180 })
  await dropPaletteNode(page, 'translate', { x: 500, y: 180 })
  const cube = await node(page, 'Cube')
  const translate = await node(page, 'Translate')

  // New normally-collapsible nodes are expanded, and a visible wire remains
  // structurally intact through collapse and expansion.
  const toggle = translate.getByRole('button', { name: 'Collapse node' })
  await expect(toggle).toHaveAttribute('aria-expanded', 'true')
  await expect(toggle.locator('svg[aria-hidden="true"]')).toHaveCount(1)
  await expect(toggle.locator('path')).toHaveAttribute('d', 'm6 15 6-6 6 6')
  await connect(page, cube.locator('.node-port--output .node-socket'), translate.locator('.node-port--input .node-socket'))
  await expect(page.locator('node-editor .connection')).toHaveCount(1)
  await toggle.click()
  const expand = translate.getByRole('button', { name: 'Expand node' })
  await expect(expand).toHaveAttribute('aria-expanded', 'false')
  await expect(expand.locator('path')).toHaveAttribute('d', 'm6 9 6 6 6-6')
  await translate.hover()
  await page.waitForTimeout(800)
  await expect(translate.getByRole('button', { name: 'Expand node' })).toHaveAttribute('aria-expanded', 'false')
  await expect(translate.locator('[data-param-key="x"]')).toBeHidden()
  await expect(page.locator('node-editor .connection')).toHaveCount(1)

  // Reconnecting from the occupied structural Geometry input also leaves
  // every collapsed node closed; only the already-visible compatible target
  // socket can highlight and accept the reconnected wire.
  await dropPaletteNode(page, 'rotate', { x: 820, y: 180 })
  const rotate = await node(page, 'Rotate')
  await rotate.getByRole('button', { name: 'Collapse node' }).click()
  const occupiedGeometry = await translate.locator('.node-port--input .node-socket').boundingBox()
  const rotateHeader = await rotate.locator('.node-header').boundingBox()
  if (!occupiedGeometry || !rotateHeader) throw new Error('Expected reconnect endpoints')
  await page.mouse.click(occupiedGeometry.x + occupiedGeometry.width / 2, occupiedGeometry.y + occupiedGeometry.height / 2)
  await page.mouse.move(rotateHeader.x + 20, rotateHeader.y + rotateHeader.height / 2, { steps: 6 })
  await expect(rotate.getByRole('button', { name: 'Expand node' })).toHaveAttribute('aria-expanded', 'false')
  await expect(rotate.locator('[data-param-key="x"]')).toBeHidden()
  await expect(translate.getByRole('button', { name: 'Expand node' })).toHaveAttribute('aria-expanded', 'false')
  const rotateGeometry = await rotate.locator('.node-port--input .node-socket').boundingBox()
  if (!rotateGeometry) throw new Error('Expected visible Rotate Geometry input')
  await page.mouse.click(rotateGeometry.x + rotateGeometry.width / 2, rotateGeometry.y + rotateGeometry.height / 2)
  await expect(page.locator('node-editor .connection')).toHaveCount(1)

  // The control is focusable and can expand a compact target while the real
  // click-wire gesture remains active; the visible Number input then accepts
  // that same gesture without another source pick.
  await dropPaletteNode(page, 'number', { x: 160, y: 420 })
  const number = await node(page, 'Number')
  const output = number.locator('.node-port--output .node-socket')
  const outputBox = await output.boundingBox()
  if (!outputBox) throw new Error('Expected wire gesture source')
  await page.mouse.click(outputBox.x + outputBox.width / 2, outputBox.y + outputBox.height / 2)
  await translate.getByRole('button', { name: 'Expand node' }).click()
  await expect(translate.getByRole('button', { name: 'Collapse node' })).toBeFocused()
  await expect(translate.locator('[data-param-key="x"]')).toBeVisible()
  const xSocket = translate.locator('[data-param-key="x"] .node-socket')
  const xBox = await xSocket.boundingBox()
  if (!xBox) throw new Error('Expected expanded X socket')
  await page.mouse.click(xBox.x + xBox.width / 2, xBox.y + xBox.height / 2)
  await expect(translate.locator('[data-param-key="x"] input')).toBeDisabled()
  await expect(page.locator('node-editor .connection')).toHaveCount(2)

  await translate.getByRole('button', { name: 'Collapse node' }).press('Enter')
  await expect(translate.getByRole('button', { name: 'Expand node' })).toBeFocused()
  await page.waitForTimeout(1_000)
  await page.reload()
  const restoredTranslate = await node(page, 'Translate')
  await expect(restoredTranslate.getByRole('button', { name: 'Expand node' })).toHaveAttribute('aria-expanded', 'false')
  await expect(page.locator('node-editor .connection')).toHaveCount(2)

  await dropPaletteNode(page, 'conditional', { x: 760, y: 400 })
  await dropPaletteNode(page, 'if', { x: 980, y: 400 })
  await expect((await node(page, 'Conditional')).locator('.node-collapse')).toHaveCount(0)
  await expect((await node(page, 'If')).locator('.node-collapse')).toHaveCount(0)
})

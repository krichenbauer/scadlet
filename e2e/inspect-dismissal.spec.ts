import { expect, test, type Locator, type Page } from '@playwright/test'

interface Point {
  x: number
  y: number
}

async function dropPaletteNode(page: Page, type: string, point: Point): Promise<void> {
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
  if (!sourceBox || !targetBox) throw new Error('Expected visible connection sockets')
  await page.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2)
  await page.mouse.down()
  await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height / 2, { steps: 8 })
  await page.mouse.up()
}

async function openConnectedGraph(page: Page): Promise<{
  canvas: Point & { width: number; height: number }
  cube: Locator
  translate: Locator
  sphere: Locator
}> {
  await page.goto('/')
  await expect(page.getByRole('textbox', { name: 'Project name' })).toBeEnabled()
  const canvas = await page.locator('node-editor').boundingBox()
  if (!canvas) throw new Error('Expected node-editor canvas')
  await dropPaletteNode(page, 'cube', { x: canvas.x + 40, y: canvas.y + 50 })
  await dropPaletteNode(page, 'translate', { x: canvas.x + 280, y: canvas.y + 50 })
  await dropPaletteNode(page, 'sphere', { x: canvas.x + 40, y: canvas.y + 330 })
  const cube = await node(page, 'Cube')
  const translate = await node(page, 'Translate')
  const sphere = await node(page, 'Sphere')
  await connect(
    page,
    cube.locator('.node-port--output .node-socket'),
    translate.locator('.node-port--input .node-socket'),
  )
  await expect(page.locator('node-editor .connection[data-real-connection="true"]')).toHaveCount(1)
  return { canvas, cube, translate, sphere }
}

async function waitForExecutionIdle(page: Page): Promise<void> {
  await expect.poll(() => page.locator('scadlet-app').evaluate(
    (element) => !(element as unknown as { rendering: boolean }).rendering,
  ), { timeout: 15_000 }).toBe(true)
}

async function inspectNode(page: Page, node: Locator): Promise<void> {
  await node.locator('.node-title').dblclick()
  await expect(node).toHaveClass(/node--inspected/)
  await waitForExecutionIdle(page)
}

async function dragFromTo(page: Page, start: Point, end: Point, modifiers: ('Shift' | 'Control' | 'Meta')[] = []): Promise<void> {
  for (const modifier of modifiers) await page.keyboard.down(modifier)
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  await page.mouse.move(end.x, end.y, { steps: 8 })
  await page.mouse.up()
  for (const modifier of [...modifiers].reverse()) await page.keyboard.up(modifier)
}

test('a genuine empty-canvas click ends active Inspect and cancels an in-flight preview', async ({ page }) => {
  const { canvas, translate } = await openConnectedGraph(page)
  await translate.locator('.node-title').dblclick()
  await expect(translate).toHaveClass(/node--inspected/)

  await page.mouse.click(canvas.x + canvas.width - 20, canvas.y + canvas.height - 20)
  await expect(page.locator('node-editor .node.node--inspected')).toHaveCount(0)
  await waitForExecutionIdle(page)
  await page.waitForTimeout(500)
  await expect(page.locator('node-editor .node.node--inspected')).toHaveCount(0)
})

test('node, control, connection, pan, and marquee gestures preserve active Inspect', async ({ page }) => {
  const { canvas, cube, translate } = await openConnectedGraph(page)
  await inspectNode(page, translate)

  await cube.locator('.node-header').click({ position: { x: 20, y: 12 } })
  await expect(translate).toHaveClass(/node--inspected/)

  const translateHeader = await translate.locator('.node-header').boundingBox()
  if (!translateHeader) throw new Error('Expected visible Translate header')
  await dragFromTo(page, {
    x: translateHeader.x + 20,
    y: translateHeader.y + translateHeader.height / 2,
  }, {
    x: translateHeader.x + 55,
    y: translateHeader.y + translateHeader.height / 2 + 25,
  })
  await expect(translate).toHaveClass(/node--inspected/)

  await translate.getByRole('button', { name: 'Collapse node' }).click()
  await expect(translate).toHaveClass(/node--inspected/)

  await cube.locator('.node-port--output .node-socket').click()
  await expect(translate).toHaveClass(/node--inspected/)
  await page.keyboard.press('Escape')
  await expect(translate).toHaveClass(/node--inspected/)

  const blankStart = { x: canvas.x + canvas.width - 100, y: canvas.y + canvas.height - 80 }
  await dragFromTo(page, blankStart, { x: blankStart.x - 55, y: blankStart.y - 35 })
  await expect(translate).toHaveClass(/node--inspected/)

  await dragFromTo(
    page,
    { x: canvas.x + canvas.width - 90, y: canvas.y + canvas.height - 70 },
    { x: canvas.x + canvas.width - 145, y: canvas.y + canvas.height - 110 },
    ['Shift'],
  )
  await expect(translate).toHaveClass(/node--inspected/)
})

test('existing node, scope, and Render exit paths remain intact', async ({ page }) => {
  const { cube, translate, sphere } = await openConnectedGraph(page)
  await inspectNode(page, translate)

  await translate.locator('.node-title').dblclick()
  await expect(page.locator('node-editor .node.node--inspected')).toHaveCount(0)

  await inspectNode(page, translate)
  await cube.locator('.node-title').dblclick()
  await expect(cube).toHaveClass(/node--inspected/)
  await waitForExecutionIdle(page)

  await sphere.locator('.node-header').click({ position: { x: 20, y: 12 } })
  await expect(page.locator('node-editor .node.node--inspected')).toHaveCount(0)

  await inspectNode(page, translate)
  await page.getByRole('button', { name: 'Render', exact: true }).click()
  await expect(page.locator('node-editor .node.node--inspected')).toHaveCount(0)
})

test('successfully dropping a new palette node ends active Inspect', async ({ page }) => {
  const { canvas, translate } = await openConnectedGraph(page)
  await inspectNode(page, translate)

  await dropPaletteNode(page, 'cylinder', { x: canvas.x + 300, y: canvas.y + 330 })
  await expect(await node(page, 'Cylinder')).toBeVisible()
  await expect(page.locator('node-editor .node.node--inspected')).toHaveCount(0)
})

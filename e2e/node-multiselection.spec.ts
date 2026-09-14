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

async function position(node: Locator): Promise<Point> {
  const box = await node.boundingBox()
  if (!box) throw new Error('Expected visible node')
  return { x: box.x, y: box.y }
}

async function dragNodeBy(page: Page, node: Locator, delta: Point): Promise<void> {
  const header = await node.locator('.node-header').boundingBox()
  if (!header) throw new Error('Expected visible node header')
  const start = { x: header.x + 20, y: header.y + header.height / 2 }
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  await page.mouse.move(start.x + delta.x, start.y + delta.y, { steps: 8 })
  await page.mouse.up()
}

async function expectDelta(node: Locator, before: Point, delta: Point): Promise<void> {
  await expect.poll(async () => {
    const current = await position(node)
    return {
      x: Math.round(current.x - before.x),
      y: Math.round(current.y - before.y),
    }
  }).toEqual(delta)
}

async function clickNode(node: Locator, modifiers: ('Shift' | 'Control' | 'Meta')[] = []): Promise<void> {
  await node.locator('.node-header').click({ position: { x: 20, y: 12 }, modifiers })
}

async function openConnectedGraph(page: Page): Promise<{ cube: Locator; translate: Locator; sphere: Locator; canvas: Point & { width: number; height: number } }> {
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
  return { cube, translate, sphere, canvas }
}

test('dragging a connected but unselected node replaces selection and moves only that node', async ({ page }) => {
  const { cube, translate, sphere } = await openConnectedGraph(page)
  await clickNode(cube)
  await expect(cube).toHaveClass(/node--selected/)
  await expect(translate).not.toHaveClass(/node--selected/)

  const cubeBefore = await position(cube)
  const translateBefore = await position(translate)
  const sphereBefore = await position(sphere)
  await dragNodeBy(page, translate, { x: 70, y: 45 })

  await expect(cube).not.toHaveClass(/node--selected/)
  await expect(translate).toHaveClass(/node--selected/)
  await expect(sphere).not.toHaveClass(/node--selected/)
  await expectDelta(cube, cubeBefore, { x: 0, y: 0 })
  await expectDelta(translate, translateBefore, { x: 70, y: 45 })
  await expectDelta(sphere, sphereBefore, { x: 0, y: 0 })
})

test('Shift and Ctrl clicks explicitly add and remove selection members', async ({ page }) => {
  const { cube, translate, sphere } = await openConnectedGraph(page)
  await clickNode(cube)
  await clickNode(translate, ['Shift'])
  await expect(cube).toHaveClass(/node--selected/)
  await expect(translate).toHaveClass(/node--selected/)
  await expect(sphere).not.toHaveClass(/node--selected/)

  await clickNode(cube, ['Shift'])
  await expect(cube).not.toHaveClass(/node--selected/)
  await expect(translate).toHaveClass(/node--selected/)

  await clickNode(sphere, ['Control'])
  await expect(translate).toHaveClass(/node--selected/)
  await expect(sphere).toHaveClass(/node--selected/)
  await clickNode(translate, ['Control'])
  await expect(translate).not.toHaveClass(/node--selected/)
  await expect(sphere).toHaveClass(/node--selected/)
})

test('dragging either member moves the complete explicit selection and blank canvas clears it', async ({ page }) => {
  const { cube, translate, sphere, canvas } = await openConnectedGraph(page)
  await clickNode(cube)
  await clickNode(translate, ['Shift'])

  const cubeBeforeFirstDrag = await position(cube)
  const translateBeforeFirstDrag = await position(translate)
  const sphereBefore = await position(sphere)
  await dragNodeBy(page, cube, { x: 60, y: 30 })
  await expectDelta(cube, cubeBeforeFirstDrag, { x: 60, y: 30 })
  await expectDelta(translate, translateBeforeFirstDrag, { x: 60, y: 30 })
  await expectDelta(sphere, sphereBefore, { x: 0, y: 0 })

  const cubeBeforeSecondDrag = await position(cube)
  const translateBeforeSecondDrag = await position(translate)
  await dragNodeBy(page, translate, { x: -35, y: 50 })
  await expectDelta(cube, cubeBeforeSecondDrag, { x: -35, y: 50 })
  await expectDelta(translate, translateBeforeSecondDrag, { x: -35, y: 50 })
  await expectDelta(sphere, sphereBefore, { x: 0, y: 0 })
  await expect(cube).toHaveClass(/node--selected/)
  await expect(translate).toHaveClass(/node--selected/)
  await expect(sphere).not.toHaveClass(/node--selected/)

  await page.mouse.click(canvas.x + canvas.width - 20, canvas.y + canvas.height - 20)
  await expect(cube).not.toHaveClass(/node--selected/)
  await expect(translate).not.toHaveClass(/node--selected/)
  await expect(sphere).not.toHaveClass(/node--selected/)
})

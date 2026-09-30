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

test('inputs that appear after an operation switch still drive Live preview and autosave', async ({ page }) => {
  await ready(page)
  const editor = page.locator('node-editor')
  const canvas = await waitForBoundingBox(editor)
  await dropPaletteNode(page, 'cube', { x: canvas.x + 30, y: canvas.y + 30 })
  await dropPaletteNode(page, 'translate', { x: canvas.x + 330, y: canvas.y + 30 })
  await dropPaletteNode(page, 'vector3', { x: canvas.x + 30, y: canvas.y + 240 })
  await dropPaletteNode(page, 'vector-math', { x: canvas.x + 330, y: canvas.y + 240 })
  const cube = editor.locator('.node[data-node-type="cube"]')
  const translate = editor.locator('.node[data-node-type="translate"]')
  const vector = editor.locator('.node[data-node-type="vector3"]')
  const math = editor.locator('.node[data-node-type="vector-math"]')

  // Switch the palette default (Add) to Scale after creation: Factor only
  // exists from this moment on.
  await math.locator('select.node-title').selectOption('scale')
  const factor = math.locator('.node-param-row[data-param-key="factor"] input')
  await expect(factor).toHaveValue('1')

  // Translate by the scaled vector: replace its XYZ form with a Vector form.
  await translate.locator('.node-param-row[data-param-key="x"] .node-param-remove').click()
  await translate.locator('.node-add-summary').click()
  await translate.locator('.node-add-options').getByRole('button', { name: 'Vector', exact: true }).click()
  const wires = editor.locator('.connection[data-real-connection="true"]')
  await connect(page, cube.locator('.node-port--output .node-socket'), translate.locator('.node-socket[data-socket-side="input"][data-socket-key="geometry"]'))
  await expect(wires).toHaveCount(1)
  await connect(page, vector.locator('.node-port--output .node-socket'), math.locator('.node-socket[data-socket-side="input"][data-socket-key="vector"]'))
  await expect(wires).toHaveCount(2)
  await connect(page, math.locator('.node-port--output .node-socket'), translate.locator('.node-socket[data-socket-side="input"][data-socket-key="vector"]'))
  await expect(wires).toHaveCount(3)

  const source = page.locator('scadlet-app .scad-output')
  await expect(source).toContainText('translate(([0, 0, 0] * 1))', { timeout: 15_000 })
  await waitForAutosave(page)

  // Editing the late-added Factor alone must schedule a new Live render.
  await factor.fill('3')
  await expect(source).toContainText('translate(([0, 0, 0] * 3))', { timeout: 15_000 })
  await waitForAutosave(page)
  await page.reload()
  await expect(page.getByRole('textbox', { name: 'Project name' })).toBeEnabled()
  await expect(editor.locator('.node[data-node-type="vector-math"] .node-param-row[data-param-key="factor"] input')).toHaveValue('3')
})

test('the atan2 second input added by an operation switch reports its edits', async ({ page }) => {
  await ready(page)
  const editor = page.locator('node-editor')
  const canvas = await waitForBoundingBox(editor)
  await dropPaletteNode(page, 'trigonometry', { x: canvas.x + 60, y: canvas.y + 60 })
  const trig = editor.locator('.node[data-node-type="trigonometry"]')
  await trig.locator('select.node-title').selectOption('atan2')
  const second = trig.locator('.node-param-row[data-param-key="b"] input')
  await expect(second).toBeVisible()
  await waitForAutosave(page)

  await editor.evaluate((element) => {
    const canvas = element.shadowRoot!.querySelector<HTMLElement>('#canvas')!
    canvas.dataset.semanticChanges = '0'
    const instance = (element as unknown as { getEditorInstance(): { onSemanticChange(callback: () => void): () => void } }).getEditorInstance()
    instance.onSemanticChange(() => { canvas.dataset.semanticChanges = String(Number(canvas.dataset.semanticChanges) + 1) })
  })
  await second.fill('4')
  await expect(editor.locator('#canvas')).toHaveAttribute('data-semantic-changes', /^[1-9]/)
  await waitForAutosave(page)
  await page.reload()
  await expect(page.getByRole('textbox', { name: 'Project name' })).toBeEnabled()
  await expect(editor.locator('.node[data-node-type="trigonometry"] .node-param-row[data-param-key="b"] input')).toHaveValue('4')
})

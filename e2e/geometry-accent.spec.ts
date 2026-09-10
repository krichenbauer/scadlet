import { expect, test, type Locator, type Page } from '@playwright/test'

async function openEmptyProject(page: Page): Promise<void> {
  await page.goto('/')
  await expect(page.locator('scadlet-app .project-picker')).toBeEnabled()
  await expect(page.locator('scadlet-app .project-picker option')).toHaveCount(1)
}

async function dropPaletteNode(page: Page, type: string, point: { x: number; y: number }): Promise<void> {
  await page.evaluate(({ type, x, y }) => {
    const editor = document.querySelector('scadlet-app')?.shadowRoot?.querySelector('node-editor')
    const canvas = editor?.shadowRoot?.querySelector('#canvas')
    if (!canvas) throw new Error('Expected node-editor canvas')
    const dataTransfer = new DataTransfer()
    dataTransfer.setData('application/x-scadlet-node-type', type)
    canvas.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, clientX: x, clientY: y, dataTransfer }))
    canvas.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, clientX: x, clientY: y, dataTransfer }))
  }, { type, ...point })
}

async function dropModuleCall(page: Page, definitionId: string, point: { x: number; y: number }): Promise<void> {
  await page.evaluate(({ definitionId, x, y }) => {
    const editor = document.querySelector('scadlet-app')?.shadowRoot?.querySelector('node-editor')
    const canvas = editor?.shadowRoot?.querySelector('#canvas')
    if (!canvas) throw new Error('Expected node-editor canvas')
    const dataTransfer = new DataTransfer()
    dataTransfer.setData('application/x-scadlet-module-call', definitionId)
    canvas.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, clientX: x, clientY: y, dataTransfer }))
    canvas.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, clientX: x, clientY: y, dataTransfer }))
  }, { definitionId, ...point })
}

async function nodeWithModelLabel(page: Page, label: string): Promise<Locator> {
  const ids = await page.locator('node-editor').evaluate((element, wanted) =>
    (element as unknown as { getEditorInstance(): { editor: { getNodes(): { id: string; label: string }[] } } })
      .getEditorInstance().editor.getNodes().filter((node) => node.label === wanted).map((node) => node.id),
  label)
  if (ids.length !== 1) throw new Error(`Expected exactly one ${label} node, found ${ids.length}`)
  return page.locator(`node-editor .node[data-node-id="${ids[0]}"]`)
}

async function expectGeometryCue(node: Locator, expected: boolean): Promise<void> {
  await expect(node).toHaveAttribute('data-geometry-output', String(expected))
  await expect(node).toHaveClass(expected ? /node--geometry-output/ : /^(?!.*node--geometry-output).*$/)
  const shadow = await node.evaluate((element) => getComputedStyle(element).boxShadow)
  if (expected) expect(shadow).toContain('rgb(122, 192, 255)')
  else expect(shadow).not.toContain('rgb(122, 192, 255)')
}

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    Object.defineProperty(window, 'showOpenFilePicker', { value: undefined, configurable: true })
    Object.defineProperty(window, 'showSaveFilePicker', { value: undefined, configurable: true })
  })
})

test('renders a restrained Geometry accent for live Geometry outputs and matching palette sources', async ({ page }) => {
  await openEmptyProject(page)

  const palette = page.locator('node-palette')
  for (const type of ['cube', 'translate', 'union']) {
    await expect(palette.locator(`.node-item[data-node-type="${type}"]`)).toHaveClass(/node-item--geometry-output/)
  }
  for (const type of ['number', 'vector3', 'arithmetic', 'compare', 'conditional']) {
    await expect(palette.locator(`.node-item[data-node-type="${type}"]`)).not.toHaveClass(/node-item--geometry-output/)
  }

  const editor = page.locator('node-editor')
  const canvas = await editor.boundingBox()
  if (!canvas) throw new Error('Expected node-editor canvas')
  await dropPaletteNode(page, 'cube', { x: canvas.x + 110, y: canvas.y + 160 })
  await dropPaletteNode(page, 'number', { x: canvas.x + 380, y: canvas.y + 160 })
  await dropPaletteNode(page, 'arithmetic', { x: canvas.x + 380, y: canvas.y + 300 })
  await dropPaletteNode(page, 'compare', { x: canvas.x + 380, y: canvas.y + 430 })
  await dropPaletteNode(page, 'conditional', { x: canvas.x + 620, y: canvas.y + 300 })

  const cube = await nodeWithModelLabel(page, 'Cube')
  await expectGeometryCue(cube, true)
  await expectGeometryCue(await nodeWithModelLabel(page, 'Number'), false)
  await expectGeometryCue(await nodeWithModelLabel(page, 'Arithmetic'), false)
  await expectGeometryCue(await nodeWithModelLabel(page, 'Compare'), false)
  await expectGeometryCue(await nodeWithModelLabel(page, 'Conditional'), false)

  // Selection/focus adds its established selection layer without replacing
  // the Geometry inset edge.
  await cube.locator('.node-title').click()
  await expect(cube).toHaveClass(/node--selected/)
  await expectGeometryCue(cube, true)
  await expect.poll(() => cube.evaluate((element) => getComputedStyle(element).boxShadow)).toContain('0px 0px 0px 2px')
  await cube.locator('.node-pin').click()
  await cube.getByText('+ Size', { exact: true }).click()
  await cube.getByRole('button', { name: 'Scalar', exact: true }).click()
  const focusedSize = cube.locator('[data-param-key="size"] input')
  await focusedSize.focus()
  await expect(focusedSize).toBeFocused()
  await expect(cube.locator('.node-pin')).toHaveClass(/node-pin--active/)
  await expectGeometryCue(cube, true)

  await page.getByRole('button', { name: '+ New module', exact: true }).click()
  const dialog = page.getByRole('form', { name: 'Create module' })
  await dialog.getByLabel('Module name').fill('accented_module')
  await dialog.getByRole('button', { name: 'Create', exact: true }).click()
  const frame = page.locator('node-editor .definition-frame').filter({ hasText: 'module accented_module' })
  const definitionId = await frame.getAttribute('data-definition-id')
  if (!definitionId) throw new Error('Expected Module definition id')
  const inputs = await nodeWithModelLabel(page, 'Inputs')
  await expectGeometryCue(inputs, true)
  await expect(palette.locator('.module-entry[data-definition-id]').locator('.module-item')).toHaveClass(/node-item--geometry-output/)

  await dropModuleCall(page, definitionId, { x: canvas.x + 120, y: canvas.y + 470 })
  await expectGeometryCue(await nodeWithModelLabel(page, 'accented_module'), true)

  // Removing the last dynamic Geometry output immediately returns protected
  // Module Inputs to neutral; this proves the renderer is not caching a
  // classification from its original signature.
  await inputs.getByRole('button', { name: 'Edit Geometry 1', exact: true }).click()
  await inputs.getByRole('button', { name: 'Delete geometry input', exact: true }).click()
  await expectGeometryCue(inputs, false)
})

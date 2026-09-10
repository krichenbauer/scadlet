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
  const style = await node.evaluate((element) => {
    const computed = getComputedStyle(element)
    return {
      border: [computed.borderTopColor, computed.borderRightColor, computed.borderBottomColor, computed.borderLeftColor],
      shadow: computed.boxShadow,
    }
  })
  if (expected) {
    expect(style.border).toEqual(['rgb(122, 192, 255)', 'rgb(122, 192, 255)', 'rgb(122, 192, 255)', 'rgb(122, 192, 255)'])
    expect(style.shadow).not.toContain('inset')
  } else {
    expect(style.border).toEqual(['rgb(102, 102, 102)', 'rgb(102, 102, 102)', 'rgb(102, 102, 102)', 'rgb(102, 102, 102)'])
  }
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
  await dropPaletteNode(page, 'translate', { x: canvas.x + 110, y: canvas.y + 300 })
  await dropPaletteNode(page, 'difference', { x: canvas.x + 110, y: canvas.y + 450 })
  await dropPaletteNode(page, 'number', { x: canvas.x + 380, y: canvas.y + 160 })
  await dropPaletteNode(page, 'arithmetic', { x: canvas.x + 380, y: canvas.y + 300 })
  await dropPaletteNode(page, 'compare', { x: canvas.x + 380, y: canvas.y + 430 })
  await dropPaletteNode(page, 'conditional', { x: canvas.x + 620, y: canvas.y + 300 })

  const cube = await nodeWithModelLabel(page, 'Cube')
  await expectGeometryCue(cube, true)
  await expectGeometryCue(await nodeWithModelLabel(page, 'Translate'), true)
  await expectGeometryCue(await nodeWithModelLabel(page, 'Difference'), true)
  await expectGeometryCue(await nodeWithModelLabel(page, 'Number'), false)
  await expectGeometryCue(await nodeWithModelLabel(page, 'Arithmetic'), false)
  await expectGeometryCue(await nodeWithModelLabel(page, 'Compare'), false)
  await expectGeometryCue(await nodeWithModelLabel(page, 'Conditional'), false)

  // Selection/focus adds its established selection layer without replacing
  // the complete Geometry border.
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

test('creates the Geometry If from the Control flow palette with the canonical Geometry cue', async ({ page }) => {
  await openEmptyProject(page)
  const palette = page.locator('node-palette')
  const entry = palette.locator('.node-item[data-node-type="if"]')
  await expect(entry).toHaveClass(/node-item--geometry-output/)
  await expect(entry).toHaveAttribute('draggable', 'true')

  const editor = page.locator('node-editor')
  const canvas = await editor.boundingBox()
  if (!canvas) throw new Error('Expected node-editor canvas')
  await dropPaletteNode(page, 'if', { x: canvas.x + 260, y: canvas.y + 260 })
  const ifNode = await nodeWithModelLabel(page, 'If')
  await expectGeometryCue(ifNode, true)
  await expect(ifNode.locator('.node-socket[data-socket-side="input"][data-socket-key="condition"][data-socket-type="boolean"]')).toHaveCount(1)
  await expect(ifNode.locator('.node-socket[data-socket-side="input"][data-socket-key="then"][data-socket-type="geometry"]')).toHaveCount(1)
  await expect(ifNode.locator('.node-socket[data-socket-side="input"][data-socket-key="else"][data-socket-type="geometry"]')).toHaveCount(1)
  await expect(ifNode.locator('.node-socket[data-socket-side="output"][data-socket-key="geometry"][data-socket-type="geometry"]')).toHaveCount(1)
})

test('keeps nodes draggable from free surfaces without visible grab handles or control interference', async ({ page }) => {
  await openEmptyProject(page)
  const editor = page.locator('node-editor')
  const canvas = await editor.boundingBox()
  if (!canvas) throw new Error('Expected node-editor canvas')
  await dropPaletteNode(page, 'arithmetic', { x: canvas.x + 220, y: canvas.y + 180 })
  await dropPaletteNode(page, 'number', { x: canvas.x + 460, y: canvas.y + 180 })
  await dropPaletteNode(page, 'boolean', { x: canvas.x + 460, y: canvas.y + 330 })

  const arithmetic = await nodeWithModelLabel(page, 'Arithmetic')
  const number = await nodeWithModelLabel(page, 'Number')
  const boolean = await nodeWithModelLabel(page, 'Boolean')
  await expect(page.locator('node-editor .node-header-drag')).toHaveCount(0)

  const beforeDrag = await arithmetic.boundingBox()
  const freeBody = await arithmetic.locator('.node-body').boundingBox()
  if (!beforeDrag || !freeBody) throw new Error('Expected Arithmetic node bounds')
  await page.mouse.move(freeBody.x + 2, freeBody.y + freeBody.height / 2)
  await page.mouse.down()
  await page.mouse.move(freeBody.x + 92, freeBody.y + freeBody.height / 2 + 48, { steps: 6 })
  await page.mouse.up()
  const afterDrag = await arithmetic.boundingBox()
  if (!afterDrag) throw new Error('Expected moved Arithmetic node bounds')
  expect(afterDrag.x - beforeDrag.x).toBeCloseTo(90, 0)
  expect(afterDrag.y - beforeDrag.y).toBeCloseTo(48, 0)
  await expect.poll(() => page.evaluate(() => window.getSelection()?.toString() ?? '')).toBe('')

  const position = async (node: Locator) => {
    const box = await node.boundingBox()
    if (!box) throw new Error('Expected node bounds')
    return { x: box.x, y: box.y }
  }
  const expectUnmoved = async (node: Locator, before: { x: number; y: number }) => {
    const after = await position(node)
    expect(after.x).toBeCloseTo(before.x, 0)
    expect(after.y).toBeCloseTo(before.y, 0)
  }

  const arithmeticBeforeControl = await position(arithmetic)
  await arithmetic.locator('select.node-title').selectOption('modulo')
  await expect(arithmetic.locator('select.node-title')).toHaveValue('modulo')
  await expectUnmoved(arithmetic, arithmeticBeforeControl)

  const numberBeforeInput = await position(number)
  await number.locator('input.node-title').fill('Width')
  await number.locator('.node-controls--primary input[type="number"]').fill('12')
  await expectUnmoved(number, numberBeforeInput)

  const booleanBeforeCheckbox = await position(boolean)
  await boolean.locator('.node-controls--primary input[type="checkbox"]').check()
  await expect(boolean.locator('.node-controls--primary input[type="checkbox"]')).toBeChecked()
  await expectUnmoved(boolean, booleanBeforeCheckbox)

  const pinBefore = await position(arithmetic)
  await arithmetic.locator('.node-pin').click()
  await expect(arithmetic.locator('.node-pin')).toHaveClass(/node-pin--active/)
  await expectUnmoved(arithmetic, pinBefore)
})

import { expect, test, type Locator, type Page } from '@playwright/test'

async function createDefinition(page: Page, kind: 'module' | 'function', name: string): Promise<Locator> {
  await page.getByRole('button', { name: `+ New ${kind}`, exact: true }).click()
  const dialog = page.getByRole('form', { name: `Create ${kind}` })
  await dialog.getByLabel(`${kind === 'module' ? 'Module' : 'Function'} name`).fill(name)
  await dialog.getByRole('button', { name: 'Create', exact: true }).click()
  const frame = page.locator('node-editor .definition-frame').filter({ hasText: name })
  await expect(frame).toHaveCount(1)
  return frame
}

async function definitionInputs(page: Page, frame: Locator): Promise<Locator> {
  const definitionId = await frame.getAttribute('data-definition-id')
  if (!definitionId) throw new Error('Expected definition id')
  const inputsId = await page.locator('node-editor').evaluate((element, id) => {
    const editor = (element as unknown as { getEditorInstance(): { getDefinitions(): { id: string; inputsNodeId: string }[] } }).getEditorInstance()
    return editor.getDefinitions().find((definition) => definition.id === id)?.inputsNodeId
  }, definitionId)
  if (!inputsId) throw new Error('Expected Inputs node id')
  return page.locator(`node-editor .node[data-node-id="${inputsId}"]`)
}

async function openParameterPopover(inputs: Locator): Promise<Locator> {
  await inputs.locator('.node-add-summary').click()
  await inputs.getByRole('button', { name: 'Parameter', exact: true }).click()
  const popover = inputs.locator('.node-parameter-popover')
  await expect(popover).toBeVisible()
  return popover
}

async function dropNumberInFrame(page: Page, frame: Locator): Promise<Locator> {
  const bounds = await frame.boundingBox()
  if (!bounds) throw new Error('Expected definition bounds')
  await page.locator('node-editor').evaluate((element, point) => {
    const canvas = element.shadowRoot?.querySelector('#canvas')
    if (!canvas) throw new Error('Expected canvas')
    const dataTransfer = new DataTransfer()
    dataTransfer.setData('application/x-scadlet-node-type', 'number')
    canvas.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, clientX: point.x, clientY: point.y, dataTransfer }))
    canvas.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, clientX: point.x, clientY: point.y, dataTransfer }))
  }, { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 })
  const number = page.locator('node-editor .node').filter({ has: page.locator('.node-title[aria-label="Number Name"]') })
  await expect(number).toHaveCount(1)
  return number
}

async function connect(page: Page, source: Locator, target: Locator): Promise<void> {
  const start = await source.boundingBox()
  const end = await target.boundingBox()
  if (!start || !end) throw new Error('Expected socket bounds')
  await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2)
  await page.mouse.down()
  await page.mouse.move(end.x + end.width / 2, end.y + end.height / 2, { steps: 8 })
  await page.mouse.up()
}

test('Module and Function parameter popovers preserve Inputs layout and signature lifecycle', async ({ page }) => {
  test.setTimeout(60_000)
  await page.goto('/')
  await expect(page.locator('scadlet-app .project-name')).toBeEnabled()

  const moduleFrame = await createDefinition(page, 'module', 'panel')
  const moduleInputs = await definitionInputs(page, moduleFrame)
  const before = await moduleInputs.boundingBox()
  if (!before) throw new Error('Expected Module Inputs bounds')
  const modulePopover = await openParameterPopover(moduleInputs)
  await expect(modulePopover.getByRole('heading', { name: 'New parameter' })).toBeVisible()
  await expect(modulePopover.getByLabel('Name', { exact: true })).toBeFocused()
  const after = await moduleInputs.boundingBox()
  expect(after).toEqual(before)

  // Validation stays in the established creation lifecycle; it keeps this
  // transient proposal open and leaves the signature untouched.
  await modulePopover.getByLabel('Name', { exact: true }).fill('not valid')
  await modulePopover.getByLabel('Name', { exact: true }).press('Enter')
  await expect(modulePopover.getByRole('alert')).toContainText('valid identifiers')
  await expect(moduleInputs.locator('.node-socket[aria-label="not valid"]')).toHaveCount(0)
  await modulePopover.getByLabel('Name', { exact: true }).press('Escape')
  await expect(modulePopover).toHaveCount(0)

  const addModuleParameter = await openParameterPopover(moduleInputs)
  await addModuleParameter.getByLabel('Name', { exact: true }).fill('width')
  await addModuleParameter.getByLabel('Default', { exact: true }).fill('24')
  await addModuleParameter.getByRole('button', { name: 'Add', exact: true }).click()
  await expect(moduleInputs.locator('.node-socket[aria-label="width"]')).toHaveCount(1)

  const duplicate = await openParameterPopover(moduleInputs)
  await duplicate.getByLabel('Name', { exact: true }).fill('width')
  await duplicate.getByRole('button', { name: 'Add', exact: true }).click()
  await expect(duplicate.getByRole('alert')).toContainText('already exists')
  await duplicate.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(moduleInputs.locator('.node-socket[aria-label="width"]')).toHaveCount(1)

  const functionFrame = await createDefinition(page, 'function', 'multiplier')
  const functionInputs = await definitionInputs(page, functionFrame)
  const functionPopover = await openParameterPopover(functionInputs)
  await functionPopover.getByLabel('Name', { exact: true }).fill('factor')
  await functionPopover.getByLabel('Default', { exact: true }).fill('3')
  await functionPopover.getByRole('button', { name: 'Add', exact: true }).click()
  await expect(functionInputs.locator('.node-socket[aria-label="factor"]')).toHaveCount(1)

  // Resolve the Function through the visible graph, then assert that the
  // generated source receives the parameter created by the popover.
  const number = await dropNumberInFrame(page, functionFrame)
  const functionId = await functionFrame.getAttribute('data-definition-id')
  if (!functionId) throw new Error('Expected Function id')
  const outputId = await page.locator('node-editor').evaluate((element, id) => {
    const editor = (element as unknown as { getEditorInstance(): { getDefinitions(): { id: string; outputNodeId: string }[] } }).getEditorInstance()
    return editor.getDefinitions().find((definition) => definition.id === id)?.outputNodeId
  }, functionId)
  if (!outputId) throw new Error('Expected Function Output node id')
  const output = page.locator(`node-editor .node[data-node-id="${outputId}"]`)
  await connect(page, number.locator('.node-port--output .node-socket'), output.locator('.node-port--input .node-socket'))
  await page.getByRole('button', { name: 'Render', exact: true }).click()
  await expect(page.locator('scadlet-app .scad-output')).toContainText('function multiplier(factor = 3) = 10;', { timeout: 15_000 })

  // The normal dirty/autosave path is unchanged by the presentation-only
  // popover. Reload restores both signatures through the v6 project format.
  await page.waitForTimeout(800)
  await page.reload()
  await expect(page.locator('node-editor .node').filter({ has: page.locator('.node-title', { hasText: 'Inputs' }) }).locator('.node-socket[aria-label="width"]')).toHaveCount(1)
  await expect(page.locator('node-editor .node').filter({ has: page.locator('.node-title', { hasText: 'Inputs' }) }).locator('.node-socket[aria-label="factor"]')).toHaveCount(1)
})

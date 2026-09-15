import { expect, test, type Locator, type Page } from '@playwright/test'

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
    canvas.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, composed: true, clientX: input.x, clientY: input.y, dataTransfer }))
    canvas.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, composed: true, clientX: input.x, clientY: input.y, dataTransfer }))
  }, { type, ...point })
}

async function createModule(page: Page, name: string): Promise<Locator> {
  await page.getByRole('button', { name: '+ New module', exact: true }).click()
  const dialog = page.getByRole('form', { name: 'Create module' })
  await dialog.getByLabel('Module name').fill(name)
  await dialog.getByRole('button', { name: 'Create', exact: true }).click()
  const frame = page.locator('node-editor .definition-frame').filter({ hasText: name })
  await expect(frame).toHaveCount(1)
  return frame
}

async function moduleInputs(page: Page, frame: Locator): Promise<Locator> {
  const definitionId = await frame.getAttribute('data-definition-id')
  if (!definitionId) throw new Error('Expected definition id')
  const inputsId = await page.locator('node-editor').evaluate((element, id) => {
    const instance = (element as unknown as { getEditorInstance(): { getDefinitions(): { id: string; inputsNodeId: string }[] } }).getEditorInstance()
    return instance.getDefinitions().find((definition) => definition.id === id)?.inputsNodeId
  }, definitionId)
  if (!inputsId) throw new Error('Expected Inputs node id')
  return page.locator(`node-editor .node[data-node-id="${inputsId}"]`)
}

test('node Add, nested Add, and More menus dismiss on node, canvas, and socket interaction', async ({ page }) => {
  await ready(page)
  const bounds = await page.locator('node-editor').boundingBox()
  if (!bounds) throw new Error('Expected editor bounds')
  await dropPaletteNode(page, 'scad-settings', { x: bounds.x + 260, y: bounds.y + 100 })
  await dropPaletteNode(page, 'cube', { x: bounds.x + 520, y: bounds.y + 240 })

  const settings = page.locator('node-editor .node').filter({ has: page.locator('.node-title', { hasText: 'SCAD settings' }) })
  const cube = page.locator('node-editor .node').filter({ has: page.locator('.node-title', { hasText: 'Cube' }) })
  const settingsAdd = settings.locator('.node-add-menu')
  const settingsTrigger = settings.locator('.node-add-summary')

  await settingsTrigger.click()
  await expect(settingsAdd).toHaveAttribute('open', '')
  await expect(settingsTrigger).toHaveAttribute('aria-expanded', 'true')
  await cube.locator('.node-body').click()
  await expect(settingsAdd).not.toHaveAttribute('open', '')
  await expect(settingsTrigger).toHaveAttribute('aria-expanded', 'false')

  await settingsTrigger.click()
  await page.mouse.click(bounds.x + 18, bounds.y + bounds.height - 18)
  await expect(settingsAdd).not.toHaveAttribute('open', '')

  await settingsTrigger.click()
  await settings.getByRole('button', { name: 'Fragment count ($fn)', exact: true }).click()
  await expect(settings.locator('.node-param-row[data-param-key="fn"]')).toBeVisible()
  await settings.locator('.node-add-summary').click()
  await settings.locator('.node-param-row[data-param-key="fn"] .node-socket').dispatchEvent('pointerdown', { button: 0, bubbles: true, composed: true })
  await expect(settings.locator('.node-add-menu')).not.toHaveAttribute('open', '')
  await page.keyboard.press('Escape')

  const more = cube.locator('.node-more-menu')
  const moreTrigger = cube.locator('.node-more-summary')
  await moreTrigger.click()
  await expect(more).toHaveAttribute('open', '')
  await settings.locator('.node-param-value').dispatchEvent('pointerdown', { button: 0, bubbles: true, composed: true })
  await expect(more).not.toHaveAttribute('open', '')
  await expect(moreTrigger).toHaveAttribute('aria-expanded', 'false')

  await cube.locator('.node-add-summary').click()
  await cube.getByText('Size', { exact: true }).click()
  const nested = cube.locator('.node-action-menu')
  await expect(nested).toHaveAttribute('open', '')
  await expect(cube.locator('.node-add-menu')).toHaveAttribute('open', '')
  await cube.getByRole('button', { name: 'XYZ', exact: true }).click()
  await expect(cube.locator('[data-param-key="sizeX"], [data-param-key="sizeY"], [data-param-key="sizeZ"]')).toHaveCount(3)
})

test('File and Projects popups switch cleanly, retain in-popup controls, and dismiss from the 3D viewer', async ({ page }) => {
  await ready(page)
  const bounds = await page.locator('node-editor').boundingBox()
  if (!bounds) throw new Error('Expected editor bounds')
  await dropPaletteNode(page, 'cube', { x: bounds.x + 300, y: bounds.y + 120 })

  const fileTrigger = page.getByRole('button', { name: /^File\b/ })
  const projectsTrigger = page.getByRole('button', { name: 'Projects' })
  const fileMenu = page.locator('scadlet-app .file-menu')
  const projects = page.locator('scadlet-app .project-menu')

  await fileTrigger.click()
  await expect(fileMenu).toBeVisible()
  await expect(fileTrigger).toHaveAttribute('aria-expanded', 'true')
  await projectsTrigger.click()
  await expect(fileMenu).toHaveCount(0)
  await expect(fileTrigger).toHaveAttribute('aria-expanded', 'false')
  await expect(projects).toBeVisible()

  await projects.getByLabel('Sort').selectOption('alphabetical')
  await expect(projects).toBeVisible()
  await projects.locator('.project-menu-list').dispatchEvent('wheel', { deltaY: 100, bubbles: true, composed: true })
  await expect(projects).toBeVisible()

  await fileTrigger.click()
  await expect(projects).toHaveCount(0)
  await expect(projectsTrigger).toHaveAttribute('aria-expanded', 'false')
  await expect(fileMenu).toBeVisible()
  await page.locator('geometry-viewer #canvas-host').click({ position: { x: 40, y: 40 } })
  await expect(fileMenu).toHaveCount(0)

  await projectsTrigger.click()
  await page.locator('geometry-viewer #canvas-host').dispatchEvent('wheel', { deltaY: 100, bubbles: true, composed: true })
  await expect(projects).toHaveCount(0)

  await expect(page.locator('geometry-viewer .view-recovery-control')).toBeEnabled({ timeout: 15_000 })
  await fileTrigger.click()
  await page.locator('geometry-viewer .view-recovery-control').click()
  await expect(fileMenu).toHaveCount(0)

  await fileTrigger.click()
  await page.keyboard.press('Escape')
  await expect(fileMenu).toHaveCount(0)
  await expect(fileTrigger).toHaveAttribute('aria-expanded', 'false')
  await expect(fileTrigger).toBeFocused()
})

test('definition More and parameter popovers dismiss consistently while preserving in-popup editing and Escape focus', async ({ page }) => {
  await ready(page)
  const frame = await createModule(page, 'popup_scope')
  const inputs = await moduleInputs(page, frame)

  const frameMore = frame.locator('.definition-frame-more')
  const frameTrigger = frame.locator('summary[aria-label="More actions"]')
  await frameTrigger.click()
  await expect(frameMore).toHaveAttribute('open', '')
  await inputs.locator('.node-body').click()
  await expect(frameMore).not.toHaveAttribute('open', '')
  await expect(frameTrigger).toHaveAttribute('aria-expanded', 'false')

  const addTrigger = inputs.locator('.node-add-summary')
  await addTrigger.click()
  await inputs.getByRole('button', { name: 'Parameter', exact: true }).click()
  let popover = inputs.locator('.node-parameter-popover')
  await expect(popover).toBeVisible()
  await expect(addTrigger).toHaveAttribute('aria-expanded', 'true')
  await popover.getByLabel('Name', { exact: true }).fill('enabled')
  await popover.getByLabel('Type', { exact: true }).selectOption('boolean')
  await expect(popover).toBeVisible()
  await expect(popover.getByLabel('Name', { exact: true })).toHaveValue('enabled')

  await page.locator('geometry-viewer #canvas-host').click({ position: { x: 50, y: 50 } })
  await expect(popover).toHaveCount(0)
  await expect(inputs.locator('.node-add-summary')).toHaveAttribute('aria-expanded', 'false')

  await inputs.locator('.node-add-summary').click()
  await inputs.getByRole('button', { name: 'Parameter', exact: true }).click()
  popover = inputs.locator('.node-parameter-popover')
  await expect(popover.getByLabel('Name', { exact: true })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(popover).toHaveCount(0)
  await expect(inputs.locator('.node-add-summary')).toHaveAttribute('aria-expanded', 'false')
  await expect(inputs.locator('.node-add-summary')).toBeFocused()
})

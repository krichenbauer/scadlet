import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test, type Page } from '@playwright/test'

const ROOT = fileURLToPath(new URL('..', import.meta.url))

async function waitForLocalLibrary(page: Page) {
  await page.goto('/')
  await expect(page.locator('scadlet-app .project-picker')).toBeEnabled()
  await expect(page.locator('scadlet-app .project-picker option')).toHaveCount(1)
}

async function renameProject(page: Page, name: string) {
  const input = page.locator('scadlet-app .project-name')
  await input.fill(name)
  await input.press('Tab')
  await expect(page.locator('scadlet-app .dirty-indicator')).toBeHidden({ timeout: 5_000 })
}

async function addAndEditCube(page: Page, size: string) {
  await page.getByRole('button', { name: 'Cube', exact: true }).click()
  const node = page.locator('node-editor .node').filter({ has: page.locator('.node-title', { hasText: 'Cube' }) })
  await expect(node).toHaveCount(1)
  await node.locator('.node-pin').click()
  await node.getByText('+ Size', { exact: true }).click()
  await node.getByRole('button', { name: 'XYZ', exact: true }).click()
  await node.locator('[data-param-key="sizeX"] input').fill(size)
  await expect(page.locator('scadlet-app .dirty-indicator')).toBeHidden({ timeout: 5_000 })
}

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    // Exercise SCADlet's baseline file-input/download implementation;
    // native picker UI cannot be driven portably in headless CI.
    Object.defineProperty(window, 'showOpenFilePicker', { value: undefined, configurable: true })
    Object.defineProperty(window, 'showSaveFilePicker', { value: undefined, configurable: true })
  })
})

test('Cube Size add menu exposes one selected representation at a time', async ({ page }) => {
  await waitForLocalLibrary(page)
  await page.getByRole('button', { name: 'Cube', exact: true }).click()
  const node = page.locator('node-editor .node').filter({ hasText: 'Cube' })
  await node.locator('.node-pin').click()

  await node.getByText('+ Size', { exact: true }).click()
  await expect(node.getByRole('button', { name: 'Scalar', exact: true })).toBeVisible()
  await expect(node.getByRole('button', { name: 'XYZ', exact: true })).toBeVisible()
  await expect(node.getByRole('button', { name: 'Vector', exact: true })).toBeVisible()
  await node.getByRole('button', { name: 'Scalar', exact: true }).click()
  await expect(node.locator('[data-param-key="size"]')).toHaveCount(1)
  await expect(node.locator('[data-param-key="sizeX"], [data-param-key="sizeY"], [data-param-key="sizeZ"], [data-param-key="sizeVector"]')).toHaveCount(0)

  await node.locator('.node-param-header select').selectOption('xyz')
  await expect(node.locator('[data-param-key="sizeX"], [data-param-key="sizeY"], [data-param-key="sizeZ"]')).toHaveCount(3)
  await expect(node.locator('[data-param-key="size"], [data-param-key="sizeVector"]')).toHaveCount(0)

  await node.locator('.node-param-header select').selectOption('vector')
  await expect(node.locator('[data-param-key="sizeVector"]')).toHaveCount(1)
  await expect(node.locator('[data-param-key="size"], [data-param-key="sizeX"], [data-param-key="sizeY"], [data-param-key="sizeZ"]')).toHaveCount(0)
})

test('vector transforms expose one representation and Center has a Boolean row', async ({ page }) => {
  await waitForLocalLibrary(page)
  await page.getByRole('button', { name: 'Translate', exact: true }).click()
  const translate = page.locator('node-editor .node').filter({ has: page.locator('.node-title', { hasText: 'Translate' }) })
  await translate.locator('.node-pin').click()
  await expect(translate.locator('[data-param-key="x"], [data-param-key="y"], [data-param-key="z"]')).toHaveCount(3)
  await expect(translate.locator('[data-param-key="vector"]')).toHaveCount(0)
  await translate.locator('[data-param-key="x"] input').fill('12')
  await translate.locator('.node-param-header select').selectOption('vector')
  await expect(translate.locator('[data-param-key="vector"]')).toHaveCount(1)
  await expect(translate.locator('[data-param-key="x"], [data-param-key="y"], [data-param-key="z"]')).toHaveCount(0)
  await translate.locator('.node-param-header select').selectOption('xyz')
  await expect(translate.locator('[data-param-key="x"] input')).toHaveValue('12')

  await page.getByRole('button', { name: 'Cube', exact: true }).click()
  const cube = page.locator('node-editor .node').filter({ has: page.locator('.node-title', { hasText: 'Cube' }) })
  await cube.locator('.node-pin').click()
  await cube.getByRole('button', { name: '+ Center', exact: true }).click()
  await expect(cube.locator('[data-param-key="center"] input[type="checkbox"]')).toHaveCount(1)
  await expect(cube.locator('[data-param-key="center"] .node-socket[data-socket-type="boolean"]')).toHaveCount(1)
})

test('variadic Boolean nodes use compact localized child affordances', async ({ page }) => {
  await waitForLocalLibrary(page)
  await page.getByRole('button', { name: 'Union', exact: true }).click()
  const union = page.locator('node-editor .node').filter({ has: page.locator('.node-title', { hasText: 'Union' }) })
  await expect(union.locator('.node-port-label')).toHaveText('+')
  await expect(union.locator('.node-socket[aria-label="Add geometry child"]')).toHaveCount(1)
  await expect(union.getByText('Geometry child', { exact: true })).toHaveCount(0)

  await page.getByRole('button', { name: 'Intersection', exact: true }).click()
  const intersection = page.locator('node-editor .node').filter({ has: page.locator('.node-title', { hasText: 'Intersection' }) })
  await expect(intersection.locator('.node-port-label')).toHaveText('+')
  await expect(intersection.locator('.node-socket[aria-label="Add geometry child"]')).toHaveCount(1)
})

test('typed value nodes remain compact and a Number drives Cube Size', async ({ page }) => {
  await waitForLocalLibrary(page)
  await page.getByRole('button', { name: 'Number', exact: true }).click()
  await page.getByRole('button', { name: 'Cube', exact: true }).click()
  const number = page.locator('node-editor .node').filter({ has: page.locator('.node-title', { hasText: 'Number' }) })
  const cube = page.locator('node-editor .node').filter({ has: page.locator('.node-title', { hasText: 'Cube' }) })
  await expect(number.locator('.node-controls--primary input[type="number"]')).toBeVisible()
  await number.locator('.node-controls--primary input[type="number"]').fill('20')
  await cube.locator('.node-pin').click()
  await cube.getByText('+ Size', { exact: true }).click()
  await cube.getByRole('button', { name: 'Scalar', exact: true }).click()

  // Palette clicks deliberately place nodes at the visible center. Move the
  // Number first so the two socket targets are distinct for this real-canvas
  // connection gesture.
  const numberHeader = await number.locator('.node-header').boundingBox()
  if (!numberHeader) throw new Error('Expected Number node header')
  await page.mouse.move(numberHeader.x + 20, numberHeader.y + numberHeader.height / 2)
  await page.mouse.down()
  await page.mouse.move(numberHeader.x - 180, numberHeader.y + numberHeader.height / 2, { steps: 8 })
  await page.mouse.up()

  const source = await number.locator('.node-port--output .node-socket').boundingBox()
  const target = await cube.locator('[data-param-key="size"] .node-socket').boundingBox()
  if (!source || !target) throw new Error('Expected Number and Cube Size sockets')
  await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2)
  await page.mouse.down()
  await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 8 })
  await page.mouse.up()
  await expect(cube.locator('[data-param-key="size"] input')).toBeDisabled()

  await page.getByRole('button', { name: 'Render', exact: true }).click()
  await expect(page.locator('scadlet-app .scad-output')).toContainText('cube(20);', { timeout: 15_000 })
})

test('autosaves canonical graph state and restores it after reload', async ({ page }) => {
  await waitForLocalLibrary(page)
  await renameProject(page, 'Persistent Cube')
  await addAndEditCube(page, '42')

  const activeBefore = await page.locator('scadlet-app .project-picker').inputValue()
  await page.reload()
  await expect(page.locator('scadlet-app .project-picker')).toHaveValue(activeBefore)
  await expect(page.locator('scadlet-app .project-name')).toHaveValue('Persistent Cube')
  const restoredCube = page.locator('node-editor .node').filter({ hasText: 'Cube' })
  await expect(restoredCube.locator('[data-param-key="sizeX"] input')).toHaveValue('42')
})

test('keeps different projects active independently per tab and detects same-project conflicts', async ({ page, context }) => {
  await waitForLocalLibrary(page)
  await renameProject(page, 'Project A')
  await addAndEditCube(page, '11')
  const projectAId = await page.locator('scadlet-app .project-picker').inputValue()

  const second = await context.newPage()
  await second.goto('/')
  await expect(second.locator('scadlet-app .project-picker')).toHaveValue(projectAId)
  await second.getByRole('button', { name: 'New', exact: true }).click()
  await renameProject(second, 'Project B')
  await second.getByRole('button', { name: 'Sphere', exact: true }).click()
  await expect(second.locator('scadlet-app .dirty-indicator')).toBeHidden({ timeout: 5_000 })
  const projectBId = await second.locator('scadlet-app .project-picker').inputValue()
  expect(projectBId).not.toBe(projectAId)
  await expect(page.locator('scadlet-app .project-picker')).toHaveValue(projectAId)

  await page.reload()
  await second.reload()
  await expect(page.locator('scadlet-app .project-picker')).toHaveValue(projectAId)
  await expect(second.locator('scadlet-app .project-picker')).toHaveValue(projectBId)

  await second.locator('scadlet-app .project-picker').selectOption(projectAId)
  await expect(second.locator('scadlet-app .project-name')).toHaveValue('Project A')
  await renameProject(page, 'Project A updated')
  await expect(second.locator('scadlet-app .persistence-status')).toContainText('changed in another SCADlet tab')

  const staleName = second.locator('scadlet-app .project-name')
  await staleName.fill('Stale tab copy')
  await staleName.press('Tab')
  await expect(second.locator('scadlet-app .dirty-indicator')).toBeVisible()

  const storedName = await page.evaluate(async (id) => {
    const request = indexedDB.open('scadlet-projects')
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    const transaction = database.transaction('projects', 'readonly')
    const get = transaction.objectStore('projects').get(id)
    return new Promise<string>((resolve, reject) => {
      get.onsuccess = () => resolve(get.result.project.metadata.name)
      get.onerror = () => reject(get.error)
    })
  }, projectAId)
  expect(storedName).toBe('Project A updated')

  await second.getByRole('button', { name: 'Save current as a new project' }).click()
  await expect(second.locator('scadlet-app .persistence-status')).toBeHidden()
  await expect(second.locator('scadlet-app .project-name')).toHaveValue('Stale tab copy')
  expect(await second.locator('scadlet-app .project-picker').inputValue()).not.toBe(projectAId)
})

test('imports an external file under a new local identity and preserves fallback Save As', async ({ page }) => {
  await waitForLocalLibrary(page)
  const oldId = await page.locator('scadlet-app .project-picker').inputValue()
  const chooserPromise = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: 'Open', exact: true }).click()
  const chooser = await chooserPromise
  await chooser.setFiles(join(ROOT, 'docs/examples/sphere-fn50.scadlet'))

  await expect(page.locator('scadlet-app .project-name')).toHaveValue('Sphere Benchmark')
  const importedId = await page.locator('scadlet-app .project-picker').inputValue()
  expect(importedId).not.toBe(oldId)
  await expect(page.locator('scadlet-app .project-picker option')).toHaveCount(2)

  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Save As', exact: true }).click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toBe('Sphere Benchmark.scadlet')
})

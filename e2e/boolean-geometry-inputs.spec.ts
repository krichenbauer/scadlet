import { expect, test, type Locator, type Page } from './fixtures'
import { waitForAutosave, waitForBoundingBox } from './support'
import { readFile } from 'node:fs/promises'

async function openEmptyProject(page: Page): Promise<void> {
  await page.goto('/')
  await expect(page.locator('scadlet-app .project-name')).toBeEnabled()
  await page.getByRole('button', { name: 'Projects' }).click()
  await expect(page.locator('scadlet-app .project-row')).toHaveCount(1)
  await page.keyboard.press('Escape')
}

async function dropNode(page: Page, type: string, x: number, y: number): Promise<void> {
  await page.evaluate(({ type, x, y }) => {
    const canvas = document.querySelector('scadlet-app')?.shadowRoot?.querySelector('node-editor')?.shadowRoot?.querySelector('#canvas')
    if (!canvas) throw new Error('Expected node-editor canvas')
    const dataTransfer = new DataTransfer()
    dataTransfer.setData('application/x-scadlet-node-type', type)
    canvas.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, clientX: x, clientY: y, dataTransfer }))
    canvas.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, clientX: x, clientY: y, dataTransfer }))
  }, { type, x, y })
}

async function createGeometryGraph(page: Page): Promise<{ cube: Locator; sphere: Locator; cylinder: Locator; difference: Locator; intersection: Locator }> {
  await openEmptyProject(page)
  const bounds = await waitForBoundingBox(page.locator('node-editor'))
  await dropNode(page, 'cube', bounds.x + 110, bounds.y + 130)
  await dropNode(page, 'sphere', bounds.x + 110, bounds.y + 290)
  await dropNode(page, 'cylinder', bounds.x + 110, bounds.y + 450)
  await dropNode(page, 'difference', bounds.x + 390, bounds.y + 190)
  await dropNode(page, 'intersection', bounds.x + 630, bounds.y + 340)

  const nodes = {
    cube: page.locator('node-editor .node[data-node-type="cube"]'),
    sphere: page.locator('node-editor .node[data-node-type="sphere"]'),
    cylinder: page.locator('node-editor .node[data-node-type="cylinder"]'),
    difference: page.locator('node-editor .node[data-node-type="difference"]'),
    intersection: page.locator('node-editor .node[data-node-type="intersection"]'),
  }
  await expect(nodes.cube).toHaveCount(1)
  await expect(nodes.sphere).toHaveCount(1)
  await expect(nodes.cylinder).toHaveCount(1)
  await expect(nodes.difference).toHaveCount(1)
  await expect(nodes.intersection).toHaveCount(1)
  await page.getByRole('button', { name: 'Fit graph', exact: true }).click()
  return nodes
}

async function connectThreeInputs(page: Page, sources: Locator[], target: Locator, initialKeys: string[]): Promise<string> {
  const targetId = await target.getAttribute('data-node-id')
  if (!targetId) throw new Error('Expected Boolean node id')
  const sourceIds = await Promise.all(sources.map((source) => source.getAttribute('data-node-id')))
  if (sourceIds.some((id) => !id)) throw new Error('Expected source node ids')

  let inputKeys = await page.locator('node-editor').evaluate((element, id) => Object.keys(
    (element as unknown as { getEditorInstance(): { editor: { getNode(nodeId: string): { inputs: Record<string, unknown> } } } })
      .getEditorInstance().editor.getNode(id)!.inputs,
  ), targetId)
  let lastInput = initialKeys[0] ?? inputKeys[0]!
  for (let index = 0; index < sources.length; index++) {
    const sourceId = sourceIds[index]!
    if (index > 0) {
      inputKeys = await page.locator('node-editor').evaluate((element, id) => Object.keys(
        (element as unknown as { getEditorInstance(): { editor: { getNode(nodeId: string): { inputs: Record<string, unknown> } } } })
          .getEditorInstance().editor.getNode(id)!.inputs,
      ), targetId)
      lastInput = inputKeys.at(-1)!
    }
    const created = await page.locator('node-editor').evaluate(async (element, data) => {
      const editor = (element as unknown as { getEditorInstance(): { editor: {
        addConnection(connection: unknown): Promise<boolean>
      } } }).getEditorInstance().editor
      return editor.addConnection({
        id: crypto.randomUUID(), source: data.source, sourceOutput: 'geometry', target: data.target, targetInput: data.input,
      })
    }, { source: sourceId, target: targetId, input: lastInput })
    expect(created).toBe(true)
  }
  await expect(target.locator('.node-port--input')).toHaveCount(sources.length + 1)
  return lastInput
}

async function openFileMenu(page: Page): Promise<void> {
  const trigger = page.locator('scadlet-app header').getByRole('button', { name: /^File\b/ })
  if (await trigger.getAttribute('aria-expanded') !== 'true') await trigger.click()
}

test('Difference grows ordered subtractors, reuses the disconnected slot, inspects, renders, exports, and restores', async ({ page }) => {
  const { cube, sphere, cylinder, difference } = await createGeometryGraph(page)
  await connectThreeInputs(page, [cube, sphere, cylinder], difference, ['base', 'subtract'])
  const dynamicInput = await page.locator('node-editor').evaluate((element, id) => {
    const node = (element as unknown as { getEditorInstance(): { editor: { getNode(nodeId: string): { inputs: Record<string, unknown> } } } })
      .getEditorInstance().editor.getNode(id)!
    return Object.keys(node.inputs)[2]!
  }, await difference.getAttribute('data-node-id'))

  await page.getByRole('button', { name: 'Render', exact: true }).click()
  const source = page.locator('scadlet-app .scad-output')
  await expect(source).toContainText('difference() {\n    cube();\n    sphere();\n    cylinder();\n}', { timeout: 15_000 })
  await openFileMenu(page)
  await expect(page.getByRole('menuitem', { name: 'Download .stl', exact: true })).toBeEnabled({ timeout: 15_000 })
  await page.keyboard.press('Escape')

  await difference.locator('.node-title').dblclick()
  await expect(difference).toHaveClass(/node--inspected/, { timeout: 15_000 })
  await expect(source).toContainText('difference() {', { timeout: 15_000 })

  const thirdConnectionId = await page.locator('node-editor').evaluate((element, data) => {
    const editor = (element as unknown as { getEditorInstance(): { editor: { getConnections(): { id: string; target: string; targetInput: string }[] } } }).getEditorInstance().editor
    return editor.getConnections().find((connection) => connection.target === data.target && connection.targetInput === data.input)?.id
  }, { target: await difference.getAttribute('data-node-id'), input: dynamicInput })
  expect(thirdConnectionId).toBeTruthy()
  await page.locator('node-editor').evaluate(async (element, id) => {
    const editor = (element as unknown as { getEditorInstance(): { editor: { removeConnection(connectionId: string): Promise<boolean> } } }).getEditorInstance().editor
    await editor.removeConnection(id)
  }, thirdConnectionId!)
  await expect(difference.locator('.node-port--input')).toHaveCount(4)
  await expect(difference.locator(`.node-socket[data-socket-key="${dynamicInput}"]`)).toBeVisible()
  const cylinderId = await cylinder.getAttribute('data-node-id')
  const differenceId = await difference.getAttribute('data-node-id')
  await page.locator('node-editor').evaluate(async (element, data) => {
    const editor = (element as unknown as { getEditorInstance(): { editor: { addConnection(connection: unknown): Promise<boolean> } } }).getEditorInstance().editor
    return editor.addConnection({ id: crypto.randomUUID(), source: data.source, sourceOutput: 'geometry', target: data.target, targetInput: data.input })
  }, { source: cylinderId, target: differenceId, input: dynamicInput })
  await expect(difference.locator('.node-port--input')).toHaveCount(4)

  await page.getByRole('button', { name: 'Render', exact: true }).click()
  await expect(source).toContainText('cylinder();', { timeout: 15_000 })
  await openFileMenu(page)
  const scadDownload = page.waitForEvent('download')
  await page.getByRole('menuitem', { name: 'Download .scad', exact: true }).click()
  const download = await scadDownload
  const downloadPath = await download.path()
  expect(downloadPath).toBeTruthy()
  expect(await readFile(downloadPath!, 'utf8')).toContain('cylinder();')

  await waitForAutosave(page)
  await page.reload()
  await expect(page.locator('scadlet-app .scad-output')).toContainText('difference()', { timeout: 15_000 })
  const restoredDifference = page.locator('node-editor .node[data-node-type="difference"]')
  await expect(restoredDifference.locator('.node-port--input')).toHaveCount(4)
  await page.getByRole('button', { name: 'Render', exact: true }).click()
  await expect(page.locator('scadlet-app .scad-output')).toContainText('cylinder();', { timeout: 15_000 })
})

test('Intersection grows ordered Geometry inputs, renders and exports all connected children', async ({ page }) => {
  const { cube, sphere, cylinder, intersection } = await createGeometryGraph(page)
  await connectThreeInputs(page, [cube, sphere, cylinder], intersection, [])

  await page.getByRole('button', { name: 'Render', exact: true }).click()
  const source = page.locator('scadlet-app .scad-output')
  await expect(source).toContainText('intersection() {\n    cube();\n    sphere();\n    cylinder();\n}', { timeout: 15_000 })
  await openFileMenu(page)
  await expect(page.getByRole('menuitem', { name: 'Download .stl', exact: true })).toBeEnabled({ timeout: 15_000 })
  await page.keyboard.press('Escape')
  await intersection.locator('.node-title').dblclick()
  await expect(intersection).toHaveClass(/node--inspected/, { timeout: 15_000 })

  await page.getByRole('button', { name: 'Render', exact: true }).click()
  await expect(source).toContainText('intersection()', { timeout: 15_000 })
  await openFileMenu(page)
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('menuitem', { name: 'Download .scad', exact: true }).click()
  const download = await downloadPromise
  const path = await download.path()
  expect(path).toBeTruthy()
  expect(await readFile(path!, 'utf8')).toContain('intersection() {')
  await expect(intersection.locator('.node-port--input')).toHaveCount(4)
})

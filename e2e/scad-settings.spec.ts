import { readFileSync } from 'node:fs'
import { expect, test, type Locator, type Page } from '@playwright/test'

const CAMERA = { position: [80, 80, 60], target: [0, 0, 0] }

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
  const start = await source.boundingBox()
  const end = await target.boundingBox()
  if (!start || !end) throw new Error('Expected socket bounds')
  await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2)
  await page.mouse.down()
  await page.mouse.move(end.x + end.width / 2, end.y + end.height / 2, { steps: 8 })
  await page.mouse.up()
}

async function seedActiveProject(page: Page, project: unknown, id: string): Promise<void> {
  await ready(page)
  await page.evaluate(async ({ value, projectId }) => {
    const request = indexedDB.open('scadlet-projects')
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    const transaction = database.transaction('projects', 'readwrite')
    const store = transaction.objectStore('projects')
    store.clear()
    store.put({ id: projectId, revision: 1, createdAt: '', updatedAt: '', project: value })
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
      transaction.onabort = () => reject(transaction.error)
    })
    database.close()
    sessionStorage.setItem('scadlet.activeProjectId', projectId)
  }, { value: project, projectId: id })
  await page.reload()
  await expect(page.getByRole('textbox', { name: 'Project name' })).toBeEnabled()
}

function scopedProject(version = 7) {
  return {
    format: 'scadlet', version, metadata: { name: 'Settings render' },
    graph: {
      nodes: [
        { id: 'detail', type: 'number', position: { x: 50, y: 60 }, parameters: { value: 8, name: 'Detail' } },
        { id: 'double', type: 'arithmetic', position: { x: 260, y: 60 }, parameters: { operation: 'multiplication', a: 0, b: 2 } },
        { id: 'main-settings', type: 'scad-settings', position: { x: 500, y: 60 }, parameters: { fn: 30, fs: 1 } },
        { id: 'main-call', type: 'module-call', position: { x: 760, y: 60 }, parameters: { definitionId: 'part', arguments: {} } },
      ],
      connections: [
        { id: 'detail-double', source: 'detail', sourceOutput: 'value', target: 'double', targetInput: 'a' },
        { id: 'double-fn', source: 'double', sourceOutput: 'value', target: 'main-settings', targetInput: 'fn' },
      ],
    },
    definitions: [{
      id: 'part', kind: 'module', name: 'part', interface: { inputs: 'part-in', output: 'part-out' }, parameters: [], geometryInputs: [],
      graph: {
        nodes: [
          { id: 'part-in', type: 'module-inputs', position: { x: 80, y: 420 }, parameters: {} },
          { id: 'part-settings', type: 'scad-settings', position: { x: 300, y: 420 }, parameters: { fn: 12 } },
          { id: 'part-cube', type: 'cube', position: { x: 520, y: 420 }, parameters: { sizeRepresentation: 'scalar', sizeScalar: 10, sizeVector: { x: 10, y: 10, z: 10 }, size: 10 } },
          { id: 'part-out', type: 'module-output', position: { x: 760, y: 420 }, parameters: {} },
        ],
        connections: [{ id: 'part-body', source: 'part-cube', sourceOutput: 'geometry', target: 'part-out', targetInput: 'geometry' }],
      },
    }],
    editor: { viewport: { x: 0, y: 0, zoom: 0.8 } }, viewer: { camera: CAMERA },
  }
}

async function fileAction(page: Page, name: string): Promise<Locator> {
  const trigger = page.locator('scadlet-app header').getByRole('button', { name: /^File\b/ })
  if (await trigger.getAttribute('aria-expanded') !== 'true') await trigger.click()
  return page.getByRole('menuitem', { name, exact: true })
}

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    Object.defineProperty(window, 'showOpenFilePicker', { value: undefined, configurable: true })
    Object.defineProperty(window, 'showSaveFilePicker', { value: undefined, configurable: true })
  })
})

test('palette creation uses the header Add menu, unique optional rows, and one node per supported scope', async ({ page }) => {
  await ready(page)
  const canvas = await page.locator('node-editor').boundingBox()
  if (!canvas) throw new Error('Expected editor bounds')
  const paletteEntry = page.locator('node-palette .node-item[data-node-type="scad-settings"]')
  await expect(paletteEntry).toContainText('SCAD settings')
  await expect(paletteEntry.locator('.node-item-icon svg')).toHaveCount(1)
  await paletteEntry.focus()
  await expect(page.locator('node-palette [role="tooltip"]')).toContainText('SCAD settings')

  await dropPaletteNode(page, 'scad-settings', { x: canvas.x + canvas.width / 2, y: canvas.y + 100 })
  const settings = page.locator('node-editor .node').filter({ has: page.locator('.node-title', { hasText: 'SCAD settings' }) })
  await expect(settings).toHaveCount(1)
  expect(await settings.locator('.node-header').evaluate((header) => Array.from(header.children).map((item) => item.className)))
    .toEqual(['node-header-icon', 'node-title', 'node-add-menu', 'node-more-menu'])

  await settings.locator('.node-add-summary').click()
  await settings.getByRole('button', { name: 'Fragment count ($fn)', exact: true }).click()
  const fnRow = settings.locator('.node-param-row[data-param-key="fn"]')
  await expect(fnRow).toContainText('Fragment count ($fn)')
  await expect(fnRow.locator('.node-param-remove')).toHaveAttribute('aria-label', 'Remove Fragment count ($fn)')
  const headerOrder = await settings.locator('.node-header').evaluate((header) => Array.from(header.children).map((item) => item.className))
  expect(headerOrder).toEqual(['node-header-icon', 'node-title', 'node-add-menu', 'node-more-menu', 'node-collapse'])
  await settings.locator('.node-add-summary').click()
  await expect(settings.getByRole('button', { name: 'Fragment count ($fn)', exact: true })).toHaveCount(0)
  await settings.getByRole('button', { name: 'Minimum size ($fs)', exact: true }).click()
  await settings.locator('.node-param-row[data-param-key="fs"] .node-param-remove').click()
  await expect(settings.locator('.node-param-row[data-param-key="fs"]')).toHaveCount(0)

  await dropPaletteNode(page, 'scad-settings', { x: canvas.x + canvas.width / 2 + 120, y: canvas.y + 220 })
  await expect(settings).toHaveCount(1)
  await expect(page.locator('node-editor .editor-feedback')).toContainText('Only one SCAD settings node')

  await page.getByRole('button', { name: '+ New module', exact: true }).click()
  const dialog = page.getByRole('form', { name: 'Create module' })
  await dialog.getByLabel('Module name').fill('local_quality')
  await dialog.getByRole('button', { name: 'Create', exact: true }).click()
  const frame = page.locator('node-editor .definition-frame').filter({ hasText: 'local_quality' })
  const frameBox = await frame.boundingBox()
  if (!frameBox) throw new Error('Expected Module frame')
  await dropPaletteNode(page, 'scad-settings', { x: frameBox.x + frameBox.width / 2, y: frameBox.y + frameBox.height / 2 })
  await expect(settings).toHaveCount(2)
  const scopes = await page.locator('node-editor').evaluate((element) => {
    const instance = (element as unknown as { getEditorInstance(): { editor: { getNodes(): { id: string; label: string }[] }; getNodeScope(id: string): string | null } }).getEditorInstance()
    return instance.editor.getNodes().filter((node) => node.label === 'SCAD settings').map((node) => instance.getNodeScope(node.id))
  })
  expect(scopes.filter((scope) => scope === null)).toHaveLength(1)
  expect(scopes.filter((scope) => scope !== null)).toHaveLength(1)

  await page.getByRole('button', { name: '+ New function', exact: true }).click()
  const functionDialog = page.getByRole('form', { name: 'Create function' })
  await functionDialog.getByLabel('Function name').fill('quality_value')
  await functionDialog.getByRole('button', { name: 'Create', exact: true }).click()
  const functionFrame = page.locator('node-editor .definition-frame').filter({ hasText: 'quality_value' })
  const functionBox = await functionFrame.boundingBox()
  if (!functionBox) throw new Error('Expected Function frame')
  await dropPaletteNode(page, 'scad-settings', { x: functionBox.x + functionBox.width / 2, y: functionBox.y + functionBox.height / 2 })
  await expect(settings).toHaveCount(2)
  await expect(page.locator('node-editor .editor-feedback')).toContainText('Only value/math and Function Call nodes')
})

test('connected expressions render through WASM, Module settings override Main, export uses the same source, and invalid wires are refused', async ({ page }) => {
  await seedActiveProject(page, scopedProject(), 'settings-render')
  const output = page.locator('scadlet-app .scad-output')
  await expect(output).toContainText('module part()', { timeout: 15_000 })
  await expect(output).toContainText('$fn = 12;')
  await expect(output).toContainText('$fn = (8 * 2);')
  await expect(output).toContainText('$fs = 1;')
  await expect(page.locator('scadlet-app .render-error')).toHaveCount(0)
  await expect.poll(() => page.locator('geometry-viewer').evaluate((viewer) => Boolean((viewer as unknown as { mesh?: unknown }).mesh))).toBe(true)

  const source = (await output.textContent())!.trim()
  const downloadPromise = page.waitForEvent('download')
  await (await fileAction(page, 'Download .scad')).click()
  const download = await downloadPromise
  const path = await download.path()
  if (!path) throw new Error('Expected downloaded SCAD path')
  expect(readFileSync(path, 'utf8').trim()).toBe(source)

  const canvas = await page.locator('node-editor').boundingBox()
  if (!canvas) throw new Error('Expected editor bounds')
  await dropPaletteNode(page, 'boolean', { x: canvas.x + 80, y: canvas.y + canvas.height - 80 })
  const boolean = page.locator('node-editor .node').filter({ has: page.locator('.node-title[aria-label="Boolean Name"]') })
  const settings = page.locator('node-editor .node[data-node-id="main-settings"]')
  await connect(page, boolean.locator('.node-port--output .node-socket'), settings.locator('.node-param-row[data-param-key="fs"] .node-socket'))
  const invalidCount = await page.locator('node-editor').evaluate((element) => {
    const instance = (element as unknown as { getEditorInstance(): { editor: { getConnections(): { target: string; targetInput: string }[] } } }).getEditorInstance()
    return instance.editor.getConnections().filter((item) => item.target === 'main-settings' && item.targetInput === 'fs').length
  })
  expect(invalidCount).toBe(0)

  await page.reload()
  await expect(page.locator('node-editor .node[data-node-id="main-settings"] .node-param-row[data-param-key="fn"]')).toHaveAttribute('data-connected', 'true')
  await expect(page.locator('node-editor .node[data-node-id="part-settings"] .node-param-row[data-param-key="fn"]')).toHaveCount(1)
})

test('legacy v6 projects restore normally without manufacturing settings', async ({ page }) => {
  const legacy = scopedProject(6)
  legacy.graph.nodes = legacy.graph.nodes.filter((node) => node.type !== 'scad-settings')
  legacy.graph.connections = legacy.graph.connections.filter((connection) => connection.target !== 'main-settings')
  legacy.definitions[0]!.graph.nodes = legacy.definitions[0]!.graph.nodes.filter((node) => node.type !== 'scad-settings')
  await seedActiveProject(page, legacy, 'settings-legacy')
  await expect(page.locator('node-editor .node').filter({ has: page.locator('.node-title', { hasText: 'SCAD settings' }) })).toHaveCount(0)
  await expect(page.locator('scadlet-app .scad-output')).toContainText('module part()', { timeout: 15_000 })
  await expect(page.locator('scadlet-app .render-error')).toHaveCount(0)
})

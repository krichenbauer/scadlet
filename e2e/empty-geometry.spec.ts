import { expect, test, type Page } from '@playwright/test'

const CAMERA = { position: [40, 40, 40], target: [0, 0, 0] }

function differenceProject(subtractSize: number) {
  const cube = (size: number) => ({
    sizeRepresentation: 'scalar', sizeScalar: size, sizeVector: { x: size, y: size, z: size }, size, center: true,
  })
  return {
    format: 'scadlet', version: 6, metadata: { name: 'Empty Geometry' },
    graph: {
      nodes: [
        { id: 'base', type: 'cube', position: { x: 80, y: 180 }, parameters: cube(5) },
        { id: 'subtract', type: 'cube', position: { x: 320, y: 300 }, parameters: cube(subtractSize) },
        { id: 'difference', type: 'difference', position: { x: 620, y: 220 }, parameters: {} },
      ],
      connections: [
        { id: 'base-difference', source: 'base', sourceOutput: 'geometry', target: 'difference', targetInput: 'base' },
        { id: 'subtract-difference', source: 'subtract', sourceOutput: 'geometry', target: 'difference', targetInput: 'subtract' },
      ],
    },
    definitions: [], editor: { viewport: { x: 0, y: 0, zoom: 1 } }, viewer: { camera: CAMERA },
  }
}

async function seedActiveProject(page: Page, project: unknown) {
  await page.goto('/')
  await expect(page.locator('scadlet-app .project-name')).toBeEnabled()
  await page.evaluate(async (projectToStore) => {
    const request = indexedDB.open('scadlet-projects')
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    const transaction = database.transaction('projects', 'readwrite')
    const store = transaction.objectStore('projects')
    store.clear()
    store.put({ id: 'empty-geometry', revision: 1, createdAt: '', updatedAt: '', project: projectToStore })
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
      transaction.onabort = () => reject(transaction.error)
    })
    database.close()
    sessionStorage.setItem('scadlet.activeProjectId', 'empty-geometry')
  }, project)
  await page.reload()
  await page.getByRole('button', { name: 'Projects' }).click()
  await expect(page.locator('scadlet-app .project-row--active')).toContainText('Empty Geometry')
  await page.keyboard.press('Escape')
}

async function setSubtractSize(page: Page, size: string) {
  const subtract = page.locator('node-editor .node[data-node-id="subtract"]')
  const input = subtract.locator('[data-param-key="size"] input')
  await input.fill(size)
  await input.press('Tab')
  await page.waitForTimeout(800)
}

async function viewerHasMesh(page: Page): Promise<boolean> {
  return page.locator('geometry-viewer').evaluate((viewer) => Boolean((viewer as unknown as { mesh?: unknown }).mesh))
}

async function fileAction(page: Page, name: string) {
  const trigger = page.locator('scadlet-app header').getByRole('button', { name: /^File\b/ })
  if (await trigger.getAttribute('aria-expanded') !== 'true') await trigger.click()
  return page.getByRole('menuitem', { name, exact: true })
}

test('treats a valid empty Difference as a cleared, localized preview result through bundled OpenSCAD-WASM', async ({ page }) => {
  await seedActiveProject(page, differenceProject(4))

  // Startup restoration takes the normal Live path and creates the first
  // real mesh. The subsequent valid-empty render must remove this exact
  // existing preview rather than leaving it misleadingly visible.
  await expect(page.locator('scadlet-app .scad-output')).toContainText('difference()', { timeout: 15_000 })
  await expect(page.locator('scadlet-app .render-error')).toHaveCount(0)
  await expect(await fileAction(page, 'Download .stl')).toBeEnabled({ timeout: 15_000 })
  await expect.poll(() => viewerHasMesh(page)).toBe(true)

  await setSubtractSize(page, '10')
  await page.getByRole('button', { name: 'Render', exact: true }).click()

  const status = page.locator('geometry-viewer .empty-geometry-status')
  await expect(status).toHaveText('Nothing visible to render.', { timeout: 15_000 })
  await expect(status).toHaveAttribute('role', 'status')
  await expect(status).not.toHaveClass(/render-error/)
  await expect(status).toHaveCSS('background-color', 'rgba(31, 55, 65, 0.94)')
  await expect(page.locator('scadlet-app .render-error')).toHaveCount(0)
  await expect(page.locator('scadlet-app .scad-output')).toContainText('difference()', { timeout: 15_000 })
  await expect(page.locator('scadlet-app .scad-output')).toContainText('cube(5, center=true);')
  await expect(page.locator('scadlet-app .scad-output')).toContainText('cube(10, center=true);')
  await expect(await fileAction(page, 'Download .stl')).toBeEnabled()
  await expect.poll(() => viewerHasMesh(page)).toBe(false)

  // The transient preview status is excluded from the autosaved v7 project.
  const stored = await page.evaluate(async () => {
    const request = indexedDB.open('scadlet-projects')
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    const transaction = database.transaction('projects', 'readonly')
    const get = transaction.objectStore('projects').get('empty-geometry')
    const record = await new Promise<unknown>((resolve, reject) => {
      get.onsuccess = () => resolve(get.result)
      get.onerror = () => reject(get.error)
    })
    database.close()
    return JSON.stringify(record)
  })
  expect(stored).not.toContain('renderInfo')
  expect(stored).not.toContain('renderError')

  await page.reload()
  await expect(page.locator('geometry-viewer .empty-geometry-status')).toHaveText('Nothing visible to render.', { timeout: 15_000 })
  await expect(page.locator('scadlet-app .render-error')).toHaveCount(0)

  // A later visible result restores the mesh and removes the empty status.
  await setSubtractSize(page, '4')
  await page.getByRole('button', { name: 'Render', exact: true }).click()
  await expect(page.locator('geometry-viewer .empty-geometry-status')).toHaveCount(0)
  await expect(await fileAction(page, 'Download .stl')).toBeEnabled({ timeout: 15_000 })
  await expect.poll(() => viewerHasMesh(page)).toBe(true)

  // Geometry Inspect has the same preview/status result, but must not mark
  // the empty node as the provenance of a visible inspected mesh.
  await setSubtractSize(page, '10')
  const difference = page.locator('node-editor .node[data-node-id="difference"]')
  await page.getByRole('button', { name: 'Fit graph', exact: true }).click()
  await difference.locator('.node-title').dblclick()
  await expect(page.locator('geometry-viewer .empty-geometry-status')).toHaveText('Nothing visible to render.', { timeout: 15_000 })
  await expect(page.locator('node-editor .node.node--inspected')).toHaveCount(0)
  await expect.poll(() => viewerHasMesh(page)).toBe(false)

  // This overrides only graph evaluation in the UI shell; Render still goes
  // through the real bundled worker, proving malformed OpenSCAD stays a
  // diagnostic error rather than an empty result.
  await page.locator('scadlet-app').evaluate((app) => {
    const editor = app.shadowRoot?.querySelector('node-editor') as (HTMLElement & { evaluate: () => Promise<string> }) | null
    if (!editor) throw new Error('Expected node editor')
    editor.evaluate = async () => 'cube('
  })
  await page.getByRole('button', { name: 'Render', exact: true }).click()
  await expect(page.locator('scadlet-app .render-error')).toContainText('Parser error', { timeout: 15_000 })
  await expect(page.locator('geometry-viewer .empty-geometry-status')).toHaveCount(0)
})

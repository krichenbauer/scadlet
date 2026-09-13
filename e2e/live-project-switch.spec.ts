import { expect, test, type Page } from '@playwright/test'

const CAMERA = { position: [80, 80, 60], target: [0, 0, 0] }

function cubeProject(name: string, size: number) {
  return {
    format: 'scadlet', version: 6, metadata: { name },
    graph: { nodes: [{ id: 'cube', type: 'cube', position: { x: 120, y: 180 }, parameters: {
      sizeRepresentation: 'scalar', sizeScalar: size, sizeVector: { x: size, y: size, z: size }, size,
    } }], connections: [] },
    definitions: [], editor: { viewport: { x: 0, y: 0, zoom: 1 } }, viewer: { camera: CAMERA },
  }
}

async function seedProjects(page: Page): Promise<void> {
  await page.goto('/')
  await expect(page.locator('scadlet-app .project-name')).toBeEnabled()
  await page.evaluate(async (projects) => {
    const request = indexedDB.open('scadlet-projects')
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    const transaction = database.transaction('projects', 'readwrite')
    const store = transaction.objectStore('projects')
    store.clear()
    store.put({ id: 'small', revision: 1, createdAt: '', updatedAt: '2026-01-01T00:00:00.000Z', project: projects.small })
    store.put({ id: 'large', revision: 1, createdAt: '', updatedAt: '2026-01-02T00:00:00.000Z', project: projects.large })
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
      transaction.onabort = () => reject(transaction.error)
    })
    database.close()
    sessionStorage.setItem('scadlet.activeProjectId', 'small')
  }, { small: cubeProject('Small cube', 11), large: cubeProject('Large cube', 22) })
  await page.reload()
  await expect(page.locator('scadlet-app .project-name')).toHaveValue('Small cube')
}

async function selectProject(page: Page, name: string): Promise<void> {
  await page.getByRole('button', { name: 'Projects' }).click()
  await page.locator('scadlet-app .project-menu-list').getByRole('button', { name, exact: true }).click()
}

test('Projects menu immediately Live-renders the newly active local project', async ({ page }) => {
  await seedProjects(page)
  const source = page.locator('scadlet-app .scad-output')
  await page.getByRole('button', { name: 'Render', exact: true }).click()
  await expect(source).toContainText('cube(11);', { timeout: 15_000 })

  await selectProject(page, 'Large cube')
  await expect(page.locator('scadlet-app .project-name')).toHaveValue('Large cube')
  await expect(source).toContainText('cube(22);', { timeout: 15_000 })
  await expect(source).not.toContainText('cube(11);')
})

test('Live-off project switches stay idle, and enabling Live renders the current graph immediately', async ({ page }) => {
  await seedProjects(page)
  const live = page.locator('geometry-viewer .live-switch')
  await live.click()
  await expect(live).toHaveAttribute('aria-checked', 'false')
  await selectProject(page, 'Large cube')
  await expect(page.locator('scadlet-app .project-name')).toHaveValue('Large cube')
  await page.waitForTimeout(500)
  await expect(page.locator('geometry-viewer .render-spinner')).toHaveCount(0)
  await expect(page.locator('scadlet-app .scad-output')).not.toContainText('cube(22);')

  await live.click()
  await expect(live).toHaveAttribute('aria-checked', 'true')
  await expect(page.locator('scadlet-app .scad-output')).toContainText('cube(22);', { timeout: 15_000 })
})

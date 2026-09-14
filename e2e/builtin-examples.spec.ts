import { expect, test, type Page } from '@playwright/test'

async function openProjects(page: Page): Promise<void> {
  const menu = page.locator('scadlet-app .project-menu-list')
  if (!(await menu.isVisible())) await page.getByRole('button', { name: 'Projects' }).click()
  await expect(menu).toBeVisible()
}

async function storedProjects(page: Page): Promise<Array<{ id: string; name: string; nodeCount: number }>> {
  return page.evaluate(async () => {
    const request = indexedDB.open('scadlet-projects')
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    const transaction = database.transaction('projects', 'readonly')
    const get = transaction.objectStore('projects').getAll()
    const records = await new Promise<Array<{ id: string; project: { metadata: { name: string }; graph: { nodes: unknown[] } } }>>((resolve, reject) => {
      get.onsuccess = () => resolve(get.result)
      get.onerror = () => reject(get.error)
    })
    database.close()
    return records.map((record) => ({
      id: record.id,
      name: record.project.metadata.name,
      nodeCount: record.project.graph.nodes.length,
    }))
  })
}

test('production bundle exposes immutable examples separately and copies one into IndexedDB without fetching', async ({ page }) => {
  await page.goto('/')
  const projectName = page.locator('scadlet-app .project-name')
  await expect(projectName).toBeEnabled()
  await expect(projectName).not.toHaveValue(/^Example:/)
  await expect(page.locator('scadlet-app .module-dialog-backdrop')).toHaveCount(0)

  // Keep this check focused on template loading rather than the separate
  // OpenSCAD worker lifecycle, which may load its own production chunks.
  await page.locator('geometry-viewer .live-switch').click()
  await openProjects(page)

  const localSection = page.locator('scadlet-app .project-menu-section--local')
  const examplesSection = page.locator('scadlet-app .project-menu-section--examples')
  await expect(localSection.getByRole('heading', { name: 'My projects' })).toBeVisible()
  await expect(examplesSection.getByRole('heading', { name: 'Examples' })).toBeVisible()
  await expect(localSection.locator('.project-row')).toHaveCount(1)
  await expect(examplesSection.locator('.example-row')).toHaveText([
    'Boolean Operations',
    'House',
    'Parametric Bowl',
  ])
  await expect(examplesSection).not.toContainText('example_')

  const requests: string[] = []
  page.on('request', (request) => requests.push(request.url()))
  await examplesSection.getByRole('button', { name: 'House', exact: true }).click()
  await expect(projectName).toHaveValue('Example: House')
  expect(requests).toEqual([])

  const records = await storedProjects(page)
  const copied = records.find((record) => record.name === 'Example: House')
  expect(copied?.nodeCount).toBeGreaterThan(0)
  expect(copied?.id).toBe(await page.evaluate(() => sessionStorage.getItem('scadlet.activeProjectId')))

  // The local copy uses the ordinary rename/autosave/delete lifecycle.
  await projectName.fill('Edited House Copy')
  await projectName.press('Enter')
  await expect.poll(async () => (await storedProjects(page)).map((record) => record.name)).toContain('Edited House Copy')

  await openProjects(page)
  await expect(page.locator('scadlet-app .project-menu-section--examples').getByRole('button', { name: 'House', exact: true })).toBeVisible()
  page.once('dialog', (dialog) => dialog.accept())
  await page.getByRole('button', { name: 'Delete active project' }).click()
  await expect(projectName).not.toHaveValue('Edited House Copy')

  await openProjects(page)
  await expect(page.locator('scadlet-app .project-menu-section--examples').getByRole('button', { name: 'House', exact: true })).toBeVisible()
  expect((await storedProjects(page)).map((record) => record.name)).not.toContain('Edited House Copy')
})

test('repeated example openings create independent predictably named local projects', async ({ page }) => {
  await page.goto('/')
  const projectName = page.locator('scadlet-app .project-name')
  await expect(projectName).toBeEnabled()
  await page.locator('geometry-viewer .live-switch').click()

  await openProjects(page)
  await page.locator('scadlet-app .project-menu-section--examples').getByRole('button', { name: 'House', exact: true }).click()
  await expect(projectName).toHaveValue('Example: House')
  const firstId = await page.evaluate(() => sessionStorage.getItem('scadlet.activeProjectId'))

  await openProjects(page)
  await page.locator('scadlet-app .project-menu-section--examples').getByRole('button', { name: 'House', exact: true }).click()
  await expect(projectName).toHaveValue('Example: House 2')
  const secondId = await page.evaluate(() => sessionStorage.getItem('scadlet.activeProjectId'))

  expect(secondId).not.toBe(firstId)
  expect((await storedProjects(page)).map((record) => record.name)).toEqual(expect.arrayContaining([
    'Example: House',
    'Example: House 2',
  ]))

  await openProjects(page)
  const localSection = page.locator('scadlet-app .project-menu-section--local')
  await expect(localSection.getByRole('button', { name: 'Example: House', exact: true })).toBeVisible()
  await expect(localSection.getByRole('button', { name: 'Example: House 2', exact: true })).toHaveClass(/project-row--active/)
  await expect(page.locator('scadlet-app .project-menu-section--examples').getByRole('button', { name: 'House', exact: true })).toBeVisible()
})

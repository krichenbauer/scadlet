import { expect, test, type Page } from './fixtures'

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

async function viewerHasMesh(page: Page): Promise<boolean> {
  return page.locator('geometry-viewer').evaluate((viewer) => Boolean((viewer as unknown as { mesh?: unknown }).mesh))
}

test('startup restores and immediately Live-renders the persisted active project through OpenSCAD-WASM', async ({ page }) => {
  await seedProjects(page)
  const source = page.locator('scadlet-app .scad-output')
  await expect(source).toContainText('cube(11);', { timeout: 15_000 })
  await expect.poll(() => viewerHasMesh(page)).toBe(true)
})

test('Projects menu immediately Live-renders the newly active local project', async ({ page }) => {
  await seedProjects(page)
  const source = page.locator('scadlet-app .scad-output')
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

test('a project switch that fails and rolls back keeps the previous Inspect result', async ({ page }) => {
  await seedProjects(page)
  const cube = page.locator('node-editor .node[data-node-type="cube"]')
  await expect(page.locator('scadlet-app .scad-output')).toContainText('cube(11);', { timeout: 15_000 })
  await cube.locator('.node-title').dblclick()
  await expect(cube).toHaveClass(/node--inspected/)
  await expect.poll(() => page.locator('scadlet-app').evaluate(
    (element) => !(element as unknown as { rendering: boolean }).rendering,
  ), { timeout: 15_000 }).toBe(true)

  // Make the replacement graph fail after the live editor was cleared, so
  // restore must roll back to the previous project.
  await page.locator('node-editor').evaluate((element) => {
    const editor = (element as unknown as { getEditorInstance(): { editor: { addNode(node: unknown): Promise<boolean> } } }).getEditorInstance().editor
    const addNode = editor.addNode.bind(editor)
    let failed = false
    editor.addNode = async (node) => {
      if (!failed) {
        failed = true
        throw new Error('Injected restore failure')
      }
      return addNode(node)
    }
  })
  await selectProject(page, 'Large cube')
  await expect(page.locator('scadlet-app .persistence-status')).toContainText('Could not open the local project')
  await expect(page.locator('scadlet-app .project-name')).toHaveValue('Small cube')
  await expect(cube).toHaveCount(1)
  await expect(cube).toHaveClass(/node--inspected/)
  expect(await page.locator('node-editor').evaluate(
    (element) => (element as unknown as { getInspectedNodeId(): string | null }).getInspectedNodeId(),
  )).toBe('cube')
})

test('a project whose wire the editor refuses still opens, names what is missing, and keeps a backup of the original', async ({ page }) => {
  const wired = {
    format: 'scadlet', version: 8, metadata: { name: 'Wired' },
    graph: {
      nodes: [
        { id: 'cube', type: 'cube', position: { x: 120, y: 180 }, parameters: { size: 5, sizeRepresentation: 'scalar' } },
        { id: 'move', type: 'translate', position: { x: 360, y: 180 }, parameters: { x: 3, y: 0, z: 0, representation: 'xyz' } },
      ],
      connections: [{ id: 'wire', source: 'cube', sourceOutput: 'geometry', target: 'move', targetInput: 'geometry' }],
    },
    definitions: [], editor: { viewport: { x: 0, y: 0, zoom: 1 } }, viewer: { camera: CAMERA },
  }
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
    store.put({ id: 'wired', revision: 1, createdAt: '', updatedAt: '2026-01-02T00:00:00.000Z', project: projects.wired })
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
    })
    database.close()
    sessionStorage.setItem('scadlet.activeProjectId', 'small')
  }, { small: cubeProject('Small cube', 11), wired })
  await page.reload()
  await expect(page.locator('scadlet-app .project-name')).toHaveValue('Small cube')

  // Simulate an editor rule that refuses one valid stored wire, once.
  await page.locator('node-editor').evaluate((element) => {
    const editor = (element as unknown as { getEditorInstance(): { editor: { addPipe(pipe: (context: { type: string; data: { id?: string } }) => unknown): void } } }).getEditorInstance().editor
    let refused = false
    editor.addPipe((context) => {
      if (!refused && context.type === 'connectioncreate' && context.data.id === 'wire') {
        refused = true
        return undefined
      }
      return context
    })
  })
  await selectProject(page, 'Wired')
  await expect(page.locator('scadlet-app .project-name')).toHaveValue('Wired')
  await expect(page.locator('node-editor .node')).toHaveCount(2)
  await expect(page.locator('node-editor .connection[data-real-connection="true"]')).toHaveCount(0)
  const warning = page.locator('scadlet-app .restore-warning')
  await expect(warning).toHaveAttribute('role', 'alert')
  await expect(warning).toContainText('Some parts of this project could not be restored and are missing: Cube (Geometry) → Translate (Geometry).')
  await expect(warning).toContainText('The untouched original was kept as the local project "Wired (backup)".')

  // The warning survives ordinary editing and autosave until dismissed.
  await page.locator('node-editor .node[data-node-type="translate"] .node-param-row[data-param-key="x"] input').fill('4')
  await expect.poll(() => page.locator('scadlet-app').evaluate((element) => {
    const app = element as unknown as { dirty: boolean; autosaveStatus: string }
    return { dirty: app.dirty, status: app.autosaveStatus }
  }), { timeout: 10_000 }).toEqual({ dirty: false, status: 'idle' })
  await expect(warning).toBeVisible()
  await warning.getByRole('button', { name: 'Dismiss' }).click()
  await expect(warning).toHaveCount(0)

  // The backup is an ordinary local project holding the intact original.
  await selectProject(page, 'Wired (backup)')
  await expect(page.locator('scadlet-app .project-name')).toHaveValue('Wired (backup)')
  await expect(page.locator('node-editor .connection[data-real-connection="true"]')).toHaveCount(1)
  await expect(page.locator('scadlet-app .restore-warning')).toHaveCount(0)
})

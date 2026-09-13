import { expect, test, type Page } from '@playwright/test'

const CAMERA = { position: [80, 80, 60], target: [0, 0, 0] }

function cubeProject() {
  return {
    format: 'scadlet', version: 6, metadata: { name: 'View recovery' },
    graph: { nodes: [
      { id: 'cube', type: 'cube', position: { x: 80, y: 130 }, parameters: { sizeRepresentation: 'scalar', sizeScalar: 24, sizeVector: { x: 24, y: 24, z: 24 }, size: 24, center: true } },
      { id: 'sphere', type: 'sphere', position: { x: 520, y: 340 }, parameters: { mode: 'radius', r: 12, d: 24 } },
      { id: 'translate', type: 'translate', position: { x: 940, y: 190 }, parameters: { x: 0, y: 0, z: 0, representation: 'xyz' } },
    ], connections: [] },
    definitions: [], editor: { viewport: { x: 0, y: 0, zoom: 1 } }, viewer: { camera: CAMERA },
  }
}

function emptyProject() {
  const cube = (size: number) => ({ sizeRepresentation: 'scalar', sizeScalar: size, sizeVector: { x: size, y: size, z: size }, size, center: true })
  return {
    format: 'scadlet', version: 6, metadata: { name: 'Empty view recovery' },
    graph: { nodes: [
      { id: 'base', type: 'cube', position: { x: 80, y: 180 }, parameters: cube(5) },
      { id: 'subtract', type: 'cube', position: { x: 320, y: 300 }, parameters: cube(10) },
      { id: 'difference', type: 'difference', position: { x: 620, y: 220 }, parameters: {} },
    ], connections: [
      { id: 'base-difference', source: 'base', sourceOutput: 'geometry', target: 'difference', targetInput: 'base' },
      { id: 'subtract-difference', source: 'subtract', sourceOutput: 'geometry', target: 'difference', targetInput: 'subtract' },
    ] },
    definitions: [], editor: { viewport: { x: 0, y: 0, zoom: 1 } }, viewer: { camera: CAMERA },
  }
}

async function seedActiveProject(page: Page, project: unknown, id: string): Promise<void> {
  await page.goto('/')
  await expect(page.locator('scadlet-app .project-name')).toBeEnabled()
  await page.evaluate(async ({ projectToStore, projectId }) => {
    const request = indexedDB.open('scadlet-projects')
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    const transaction = database.transaction('projects', 'readwrite')
    const store = transaction.objectStore('projects')
    store.clear()
    store.put({ id: projectId, revision: 1, createdAt: '', updatedAt: '', project: projectToStore })
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
      transaction.onabort = () => reject(transaction.error)
    })
    database.close()
    sessionStorage.setItem('scadlet.activeProjectId', projectId)
  }, { projectToStore: project, projectId: id })
  await page.reload()
  await page.getByRole('button', { name: 'Projects' }).click()
  await expect(page.locator('scadlet-app .project-row--active')).toHaveCount(1)
  await page.keyboard.press('Escape')
}

async function panAndZoomAway(page: Page): Promise<void> {
  await page.locator('node-editor').evaluate(async (editor) => {
    const instance = (editor as unknown as { getEditorInstance(): { area: { area: { translate(x: number, y: number): Promise<void>; zoom(k: number, x: number, y: number): Promise<void> } } } }).getEditorInstance()
    await instance.area.area.zoom(0.12, 0, 0)
    await instance.area.area.translate(-5000, -4000)
  })
}

async function fileAction(page: Page, name: string) {
  const trigger = page.locator('scadlet-app header').getByRole('button', { name: /^File\b/ })
  if (await trigger.getAttribute('aria-expanded') !== 'true') await trigger.click()
  return page.getByRole('menuitem', { name, exact: true })
}

test('Fit graph is keyboard reachable and returns all visible nodes to the editor without changing project state', async ({ page }) => {
  await seedActiveProject(page, cubeProject(), 'view-recovery')
  const fit = page.getByRole('button', { name: 'Fit graph', exact: true })
  await expect(fit).toHaveAttribute('title', 'Fit graph')

  await panAndZoomAway(page)
  const before = await page.locator('node-editor').evaluate((editor) => {
    const instance = (editor as unknown as { getEditorInstance(): { getPersistedViewport(): unknown; editor: { getNodes(): unknown[] }; getInspectedNodeId(): string | null } }).getEditorInstance()
    return { viewport: instance.getPersistedViewport(), nodes: instance.editor.getNodes().map((node) => JSON.stringify(node)), inspect: instance.getInspectedNodeId() }
  })
  await fit.focus()
  await page.keyboard.press('Enter')

  const viewport = await page.locator('node-editor').boundingBox()
  if (!viewport) throw new Error('Expected node-editor viewport')
  for (const id of ['cube', 'sphere', 'translate']) {
    const box = await page.locator(`node-editor .node[data-node-id="${id}"]`).boundingBox()
    if (!box) throw new Error(`Expected ${id} node`) 
    expect(box.x).toBeGreaterThanOrEqual(viewport.x)
    expect(box.y).toBeGreaterThanOrEqual(viewport.y)
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.x + viewport.width)
    expect(box.y + box.height).toBeLessThanOrEqual(viewport.y + viewport.height)
  }
  const after = await page.locator('node-editor').evaluate((editor) => {
    const instance = (editor as unknown as { getEditorInstance(): { getPersistedViewport(): unknown; editor: { getNodes(): unknown[] }; getInspectedNodeId(): string | null } }).getEditorInstance()
    return { viewport: instance.getPersistedViewport(), nodes: instance.editor.getNodes().map((node) => JSON.stringify(node)), inspect: instance.getInspectedNodeId() }
  })
  expect(after).toEqual(before)
})

test('Reset 3D view frames a real OpenSCAD-WASM mesh and preserves source, inspect provenance, and stored camera', async ({ page }) => {
  await seedActiveProject(page, cubeProject(), 'view-recovery-mesh')
  await page.getByRole('button', { name: 'Render', exact: true }).click()
  await expect(await fileAction(page, 'Download .stl')).toBeEnabled({ timeout: 15_000 })
  const cube = page.locator('node-editor .node[data-node-id="cube"]')
  await cube.locator('.node-header').dblclick()
  await expect(cube).toHaveClass(/node--inspected/, { timeout: 15_000 })
  const reset = page.getByRole('button', { name: 'Reset 3D view', exact: true })
  await expect(reset).toBeEnabled()
  await expect(reset).toHaveAttribute('title', 'Reset 3D view')
  const before = await page.locator('geometry-viewer').evaluate((viewer) => {
    const value = viewer as unknown as { getPersistedCameraState(): unknown }
    return value.getPersistedCameraState()
  })
  const sourceBefore = await page.locator('scadlet-app .scad-output').textContent()
  await page.locator('geometry-viewer').evaluate((viewer) => {
    const value = viewer as unknown as { camera: { position: { set(x: number, y: number, z: number): void }; updateProjectionMatrix(): void }; controls: { target: { set(x: number, y: number, z: number): void }; update(): void } }
    value.camera.position.set(1_000_000, 1_000_000, 1_000_000)
    value.controls.target.set(900_000, 900_000, 900_000)
    value.camera.updateProjectionMatrix()
    value.controls.update()
  })
  await reset.focus()
  await page.keyboard.press('Enter')
  await expect.poll(() => page.locator('geometry-viewer').evaluate((viewer) => {
    const value = viewer as unknown as {
      camera: {
        position: { clone(): { set(x: number, y: number, z: number): { project(camera: unknown): { x: number; y: number; z: number } } } }
      }
      mesh: {
        geometry: {
          computeBoundingBox(): void
          boundingBox: { min: { x: number; y: number; z: number }; max: { x: number; y: number; z: number } }
        }
      }
    }
    value.mesh.geometry.computeBoundingBox()
    const box = value.mesh.geometry.boundingBox
    const point = value.camera.position.clone().set((box.min.x + box.max.x) / 2, (box.min.y + box.max.y) / 2, (box.min.z + box.max.z) / 2).project(value.camera)
    return Math.abs(point.x) < 1 && Math.abs(point.y) < 1 && point.z > -1 && point.z < 1
  })).toBe(true)
  expect(await page.locator('scadlet-app .scad-output').textContent()).toBe(sourceBefore)
  await expect(cube).toHaveClass(/node--inspected/)
  expect(await page.locator('geometry-viewer').evaluate((viewer) => (viewer as unknown as { getPersistedCameraState(): unknown }).getPersistedCameraState())).toEqual(before)
})

test('Reset 3D view is disabled after a valid empty Geometry render', async ({ page }) => {
  await seedActiveProject(page, emptyProject(), 'view-recovery-empty')
  await page.getByRole('button', { name: 'Render', exact: true }).click()
  await expect(page.locator('geometry-viewer .empty-geometry-status')).toHaveText('Nothing visible to render.', { timeout: 15_000 })
  await expect(page.getByRole('button', { name: 'Reset 3D view', exact: true })).toBeDisabled()
})

import { readFileSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'

/**
 * A cleared or half-typed numeric field reads back as `NaN` through
 * `valueAsNumber`. Committing that would put `NaN` into the graph, which
 * generates `cube(NaN);`, makes autosave's validating write fail (and with
 * it New/Open, which flush first), and exports a `.scadlet` file whose
 * numbers JSON-serialize to `null` - a project the validator then refuses to
 * reopen. These tests drive the real fields of all three inline-literal
 * renderers: a parameter row, a standalone value control, and a Call's
 * Vector3 components.
 */

const CAMERA = { position: [80, 80, 60], target: [0, 0, 0] }

const scalarCube = (size: number) => ({
  sizeRepresentation: 'scalar', sizeScalar: size, sizeVector: { x: size, y: size, z: size }, size,
})

function transformProject() {
  return {
    format: 'scadlet', version: 6, metadata: { name: 'Numeric literals' },
    graph: {
      nodes: [
        { id: 'cube', type: 'cube', position: { x: 80, y: 160 }, parameters: scalarCube(10) },
        { id: 'rise', type: 'number', position: { x: 80, y: 420 }, parameters: { value: 5, name: 'Rise' } },
        { id: 'translate', type: 'translate', position: { x: 520, y: 250 }, parameters: { x: 0, y: 0, z: 0, representation: 'xyz' } },
      ],
      connections: [
        { id: 'cube-translate', source: 'cube', sourceOutput: 'geometry', target: 'translate', targetInput: 'geometry' },
        { id: 'rise-translate', source: 'rise', sourceOutput: 'value', target: 'translate', targetInput: 'z' },
      ],
    },
    definitions: [], editor: { viewport: { x: 0, y: 0, zoom: 1 } }, viewer: { camera: CAMERA },
  }
}

function vectorParameterProject() {
  return {
    format: 'scadlet', version: 6, metadata: { name: 'Vector literals' },
    graph: {
      nodes: [
        { id: 'call', type: 'module-call', position: { x: 520, y: 250 }, parameters: { definitionId: 'shifted', arguments: { offset: [1, 2, 3] } } },
      ],
      connections: [],
    },
    definitions: [{
      id: 'shifted', kind: 'module', name: 'shifted', interface: { inputs: 'shifted-in', output: 'shifted-out' },
      parameters: [{ id: 'offset', name: 'offset', type: 'vector3', default: [0, 0, 0] }],
      geometryInputs: [],
      graph: {
        nodes: [
          { id: 'shifted-in', type: 'module-inputs', position: { x: 80, y: 700 }, parameters: {} },
          { id: 'shifted-cube', type: 'cube', position: { x: 340, y: 780 }, parameters: scalarCube(6) },
          { id: 'shifted-translate', type: 'translate', position: { x: 600, y: 700 }, parameters: { x: 0, y: 0, z: 0, representation: 'vector' } },
          { id: 'shifted-out', type: 'module-output', position: { x: 900, y: 700 }, parameters: {} },
        ],
        connections: [
          { id: 'offset-vector', source: 'shifted-in', sourceOutput: 'parameter:offset', target: 'shifted-translate', targetInput: 'vector' },
          { id: 'cube-translate', source: 'shifted-cube', sourceOutput: 'geometry', target: 'shifted-translate', targetInput: 'geometry' },
          { id: 'translate-output', source: 'shifted-translate', sourceOutput: 'geometry', target: 'shifted-out', targetInput: 'geometry' },
        ],
      },
    }],
    editor: { viewport: { x: 0, y: 0, zoom: 1 } }, viewer: { camera: CAMERA },
  }
}

async function seedActiveProject(page: Page, project: unknown, id: string): Promise<void> {
  await page.goto('/')
  await expect(page.getByRole('textbox', { name: 'Project name' })).toBeEnabled()
  await expect(page.getByRole('button', { name: 'Projects' })).toBeEnabled()
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
  await expect(page.getByRole('textbox', { name: 'Project name' })).toBeEnabled()
  await page.getByRole('button', { name: 'Projects' }).click()
  await expect(page.locator('scadlet-app .project-menu-list .project-row--active')).toHaveCount(1)
  await page.getByRole('button', { name: 'Projects' }).click()
}

async function fileAction(page: Page, name: string) {
  const trigger = page.locator('scadlet-app header').getByRole('button', { name: /^File\b/ })
  if (await trigger.getAttribute('aria-expanded') !== 'true') await trigger.click()
  return page.getByRole('menuitem', { name, exact: true })
}

/** Generated source is displayed before the worker returns, so this needs no
 * OpenSCAD round trip - only the evaluated project text. */
async function generatedSource(page: Page): Promise<string> {
  await page.getByRole('button', { name: 'Render', exact: true }).click()
  const output = page.locator('scadlet-app .scad-output')
  await expect(output).not.toContainText('Render to generate', { timeout: 15_000 })
  return ((await output.textContent()) ?? '').trim()
}

/** Autosave debounces for 750ms, so a failed write would surface shortly
 * after an edit rather than synchronously. */
async function expectAutosaveHealthy(page: Page): Promise<void> {
  await page.waitForTimeout(1_500)
  await expect(page.locator('scadlet-app .persistence-status')).toHaveCount(0)
  await expect(page.locator('scadlet-app .dirty-indicator')).toBeHidden()
}

test.beforeEach(async ({ context }) => {
  // Exercise the baseline file-input/download implementation; a native
  // picker cannot be driven portably in headless CI.
  await context.addInitScript(() => {
    Object.defineProperty(window, 'showOpenFilePicker', { value: undefined, configurable: true })
    Object.defineProperty(window, 'showSaveFilePicker', { value: undefined, configurable: true })
  })
})

test('an emptied numeric literal keeps its last valid value and never becomes NaN', async ({ page }) => {
  await seedActiveProject(page, transformProject(), 'numeric-literals')

  const translate = page.locator('node-editor .node[data-node-id="translate"]')
  const x = translate.locator('[data-param-key="x"] input')
  await expect(x).toHaveValue('0')
  await x.fill('12')
  await expectAutosaveHealthy(page)
  expect(await generatedSource(page)).toBe('translate([12, 0, 5]) {\n    cube(10);\n}')

  // The ordinary "select the field and delete the digits before retyping"
  // gesture on a parameter row, a Value fallback row, and a scalar
  // literal that a node also keeps as its own representation state.
  const value = page.locator('node-editor .node[data-node-id="rise"] [data-param-key="value"] input[type="number"]')
  const cube = page.locator('node-editor .node[data-node-id="cube"]')
  const size = cube.locator('[data-param-key="size"] input')
  await x.fill('')
  await value.fill('')
  await size.fill('')

  const clearedSource = await generatedSource(page)
  expect(clearedSource).not.toContain('NaN')
  expect(clearedSource).toBe('translate([12, 0, 5]) {\n    cube(10);\n}')
  await expectAutosaveHealthy(page)

  // Retyping commits normally, and the project stays exportable/importable.
  await x.fill('4')
  await value.fill('7')
  await size.fill('9')
  expect(await generatedSource(page)).toBe('translate([4, 0, 7]) {\n    cube(9);\n}')
  await expectAutosaveHealthy(page)

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    (await fileAction(page, 'Save .scadlet')).click(),
  ])
  const savedPath = await download.path()
  const saved = JSON.parse(readFileSync(savedPath, 'utf8')) as { graph: { nodes: { id: string; parameters: Record<string, unknown> }[] } }
  const savedParameters = new Map(saved.graph.nodes.map((node) => [node.id, node.parameters]))
  expect(savedParameters.get('translate')).toMatchObject({ x: 4, y: 0, z: 0 })
  expect(savedParameters.get('rise')).toMatchObject({ value: 7 })
  expect(savedParameters.get('cube')).toMatchObject({ size: 9, sizeScalar: 9 })

  const chooser = page.waitForEvent('filechooser')
  await (await fileAction(page, 'Open')).click()
  await (await chooser).setFiles(savedPath)
  await expect(page.locator('node-editor .node')).toHaveCount(3)
  await expect(page.locator('scadlet-app .render-error')).toHaveCount(0)
  expect(await generatedSource(page)).toBe('translate([4, 0, 7]) {\n    cube(9);\n}')
})

test('an emptied Vector3 component of a Call argument keeps the stored vector', async ({ page }) => {
  await seedActiveProject(page, vectorParameterProject(), 'vector-literals')

  const call = page.locator('node-editor .node[data-node-id="call"]')
  const components = call.locator('[data-param-key="parameter:offset"] input')
  await expect(components).toHaveCount(3)
  expect(await generatedSource(page)).toContain('shifted(offset = [1, 2, 3]);')

  await components.nth(1).fill('')
  const clearedSource = await generatedSource(page)
  expect(clearedSource).not.toContain('NaN')
  expect(clearedSource).toContain('shifted(offset = [1, 2, 3]);')
  await expectAutosaveHealthy(page)

  await components.nth(1).fill('8')
  expect(await generatedSource(page)).toContain('shifted(offset = [1, 8, 3]);')
  await expectAutosaveHealthy(page)
})

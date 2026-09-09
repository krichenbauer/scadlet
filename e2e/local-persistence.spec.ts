import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test, type Locator, type Page } from '@playwright/test'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const HISTORICAL_MODULE_PARAMETERS = JSON.parse(readFileSync(join(ROOT, 'src/persistence/fixtures/pre-phase4-module-parameters-v3.scadlet'), 'utf8'))
const CAMERA = { position: [40, 40, 40], target: [0, 0, 0] }

function nestedFunctionProject() {
  return {
    format: 'scadlet', version: 5, metadata: { name: 'Nested lifecycle' },
    graph: {
      nodes: [
        { id: 'main-outer-call', type: 'function-call', position: { x: 60, y: 570 }, parameters: { definitionId: 'outer', arguments: {} } },
        { id: 'main-cube', type: 'cube', position: { x: 320, y: 570 }, parameters: { sizeRepresentation: 'scalar', sizeScalar: 10, sizeVector: { x: 10, y: 10, z: 10 }, size: 10 } },
      ],
      connections: [{ id: 'main-size', source: 'main-outer-call', sourceOutput: 'value', target: 'main-cube', targetInput: 'size' }],
    },
    definitions: [
      {
        id: 'outer', kind: 'function', name: 'outer', interface: { inputs: 'outer-in', output: 'outer-out' }, parameters: [], resultType: 'number',
        graph: {
          nodes: [
            { id: 'outer-in', type: 'function-inputs', position: { x: 80, y: 330 }, parameters: {} },
            { id: 'outer-call', type: 'function-call', position: { x: 300, y: 330 }, parameters: { definitionId: 'inner', arguments: {} } },
            { id: 'outer-out', type: 'function-output', position: { x: 520, y: 330 }, parameters: {} },
          ],
          connections: [{ id: 'outer-result', source: 'outer-call', sourceOutput: 'value', target: 'outer-out', targetInput: 'result' }],
        },
      },
      {
        id: 'inner', kind: 'function', name: 'inner', interface: { inputs: 'inner-in', output: 'inner-out' }, parameters: [], resultType: 'number',
        graph: {
          nodes: [
            { id: 'inner-in', type: 'function-inputs', position: { x: 80, y: 70 }, parameters: {} },
            { id: 'inner-value', type: 'number', position: { x: 300, y: 70 }, parameters: { value: 10, name: 'Ten' } },
            { id: 'inner-out', type: 'function-output', position: { x: 520, y: 70 }, parameters: {} },
          ],
          connections: [{ id: 'inner-result', source: 'inner-value', sourceOutput: 'value', target: 'inner-out', targetInput: 'result' }],
        },
      },
    ],
    editor: { viewport: { x: 0, y: 0, zoom: 1 } }, viewer: { camera: CAMERA },
  }
}

/** A complete visible-project fixture for the ternary expression path. It
 * intentionally drives the real Render button/WASM worker instead of a mock
 * evaluator, then is reloaded through the normal autosave store. */
function absoluteConditionalProject() {
  return {
    format: 'scadlet', version: 5, metadata: { name: 'Absolute conditional' },
    graph: {
      nodes: [
        { id: 'main-absolute', type: 'function-call', position: { x: 60, y: 570 }, parameters: { definitionId: 'absolute', arguments: { x: 10 } } },
        { id: 'main-cube', type: 'cube', position: { x: 320, y: 570 }, parameters: { sizeRepresentation: 'scalar', sizeScalar: 10, sizeVector: { x: 10, y: 10, z: 10 }, size: 10 } },
      ],
      connections: [{ id: 'main-size', source: 'main-absolute', sourceOutput: 'value', target: 'main-cube', targetInput: 'size' }],
    },
    definitions: [{
      id: 'absolute', kind: 'function', name: 'absolute', interface: { inputs: 'absolute-in', output: 'absolute-out' },
      parameters: [{ id: 'x', name: 'x', type: 'number', default: 0 }], resultType: 'number',
      graph: { nodes: [
        { id: 'absolute-in', type: 'function-inputs', position: { x: 40, y: 80 }, parameters: {} },
        { id: 'zero', type: 'number', position: { x: 180, y: 20 }, parameters: { value: 0, name: 'Zero' } },
        { id: 'minus-one', type: 'number', position: { x: 180, y: 150 }, parameters: { value: -1, name: 'Minus one' } },
        { id: 'compare', type: 'compare', position: { x: 330, y: 20 }, parameters: { operator: '<' } },
        { id: 'multiply', type: 'multiply', position: { x: 330, y: 150 }, parameters: { a: 0, b: 0 } },
        { id: 'conditional', type: 'conditional', position: { x: 510, y: 85 }, parameters: { valueType: 'number' } },
        { id: 'absolute-out', type: 'function-output', position: { x: 700, y: 85 }, parameters: {} },
      ], connections: [
        { id: 'compare-a', source: 'absolute-in', sourceOutput: 'parameter:x', target: 'compare', targetInput: 'a' },
        { id: 'compare-b', source: 'zero', sourceOutput: 'value', target: 'compare', targetInput: 'b' },
        { id: 'condition', source: 'compare', sourceOutput: 'value', target: 'conditional', targetInput: 'condition' },
        { id: 'multiply-a', source: 'absolute-in', sourceOutput: 'parameter:x', target: 'multiply', targetInput: 'a' },
        { id: 'multiply-b', source: 'minus-one', sourceOutput: 'value', target: 'multiply', targetInput: 'b' },
        { id: 'when-true', source: 'multiply', sourceOutput: 'value', target: 'conditional', targetInput: 'true' },
        { id: 'when-false', source: 'absolute-in', sourceOutput: 'parameter:x', target: 'conditional', targetInput: 'false' },
        { id: 'result', source: 'conditional', sourceOutput: 'result', target: 'absolute-out', targetInput: 'result' },
      ] },
    }],
    editor: { viewport: { x: 0, y: 0, zoom: 1 } }, viewer: { camera: CAMERA },
  }
}

/** A v5 project whose outer Module uses both supported nested Call kinds.
 * Keeping this fixture explicit lets the browser test exercise the normal
 * validation, restore, source generation, autosave, and real WASM path. */
function nestedModuleCallsProject() {
  const cube = { sizeRepresentation: 'scalar', sizeScalar: 10, sizeVector: { x: 10, y: 10, z: 10 }, size: 10 }
  return {
    format: 'scadlet', version: 5, metadata: { name: 'Nested module calls' },
    graph: { nodes: [{ id: 'main-outer', type: 'module-call', position: { x: 700, y: 500 }, parameters: { definitionId: 'outer', arguments: {} } }], connections: [] },
    definitions: [
      {
        id: 'outer', kind: 'module', name: 'outer', interface: { inputs: 'outer-in', output: 'outer-out' }, parameters: [{ id: 'r', name: 'r', type: 'number', default: 10 }], geometryInputs: [],
        graph: { nodes: [
          { id: 'outer-in', type: 'module-inputs', position: { x: 50, y: 330 }, parameters: {} },
          { id: 'outer-fn', type: 'function-call', position: { x: 240, y: 330 }, parameters: { definitionId: 'diameter', arguments: {} } },
          { id: 'outer-module', type: 'module-call', position: { x: 440, y: 330 }, parameters: { definitionId: 'inner', arguments: {} } },
          { id: 'outer-out', type: 'module-output', position: { x: 650, y: 330 }, parameters: {} },
        ], connections: [
          { id: 'outer-r', source: 'outer-in', sourceOutput: 'parameter:r', target: 'outer-fn', targetInput: 'parameter:r' },
          { id: 'outer-diameter', source: 'outer-fn', sourceOutput: 'value', target: 'outer-module', targetInput: 'parameter:r' },
          { id: 'outer-body', source: 'outer-module', sourceOutput: 'geometry', target: 'outer-out', targetInput: 'geometry' },
        ] },
      },
      {
        id: 'inner', kind: 'module', name: 'inner', interface: { inputs: 'inner-in', output: 'inner-out' }, parameters: [{ id: 'r', name: 'r', type: 'number', default: 10 }], geometryInputs: [],
        graph: { nodes: [
          { id: 'inner-in', type: 'module-inputs', position: { x: 50, y: 80 }, parameters: {} },
          { id: 'inner-cube', type: 'cube', position: { x: 300, y: 80 }, parameters: cube },
          { id: 'inner-out', type: 'module-output', position: { x: 550, y: 80 }, parameters: {} },
        ], connections: [
          { id: 'inner-r', source: 'inner-in', sourceOutput: 'parameter:r', target: 'inner-cube', targetInput: 'size' },
          { id: 'inner-body', source: 'inner-cube', sourceOutput: 'geometry', target: 'inner-out', targetInput: 'geometry' },
        ] },
      },
      {
        id: 'diameter', kind: 'function', name: 'diameter', interface: { inputs: 'diameter-in', output: 'diameter-out' }, parameters: [{ id: 'r', name: 'r', type: 'number', default: 10 }], resultType: 'number',
        graph: { nodes: [
          { id: 'diameter-in', type: 'function-inputs', position: { x: 50, y: -160 }, parameters: {} },
          { id: 'diameter-multiply', type: 'multiply', position: { x: 300, y: -160 }, parameters: { a: 0, b: 2 } },
          { id: 'diameter-out', type: 'function-output', position: { x: 550, y: -160 }, parameters: {} },
        ], connections: [
          { id: 'diameter-r', source: 'diameter-in', sourceOutput: 'parameter:r', target: 'diameter-multiply', targetInput: 'a' },
          { id: 'diameter-result', source: 'diameter-multiply', sourceOutput: 'value', target: 'diameter-out', targetInput: 'result' },
        ] },
      },
    ],
    editor: { viewport: { x: 0, y: 0, zoom: 1 } }, viewer: { camera: CAMERA },
  }
}

async function replaceLocalProjects(page: Page, records: unknown[], activeProjectId: string) {
  await page.evaluate(async ({ records, activeProjectId }) => {
    const request = indexedDB.open('scadlet-projects')
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    const transaction = database.transaction('projects', 'readwrite')
    const store = transaction.objectStore('projects')
    store.clear()
    for (const record of records) store.put(record)
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
      transaction.onabort = () => reject(transaction.error)
    })
    database.close()
    sessionStorage.setItem('scadlet.activeProjectId', activeProjectId)
  }, { records, activeProjectId })
}

async function readLocalRecord(page: Page, id: string) {
  return page.evaluate(async (projectId) => {
    const request = indexedDB.open('scadlet-projects')
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    const transaction = database.transaction('projects', 'readonly')
    const get = transaction.objectStore('projects').get(projectId)
    const record = await new Promise<unknown>((resolve, reject) => {
      get.onsuccess = () => resolve(get.result)
      get.onerror = () => reject(get.error)
    })
    database.close()
    return record
  }, id)
}

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
  await dropPaletteNode(page, 'cube')
  const node = page.locator('node-editor .node').filter({ has: page.locator('.node-title', { hasText: 'Cube' }) })
  await expect(node).toHaveCount(1)
  await node.locator('.node-pin').click()
  await node.getByText('+ Size', { exact: true }).click()
  await node.getByRole('button', { name: 'XYZ', exact: true }).click()
  await node.locator('[data-param-key="sizeX"] input').fill(size)
  await expect(page.locator('scadlet-app .dirty-indicator')).toBeHidden({ timeout: 5_000 })
}

/** Graph-node palette entries are deliberately drag-only. This dispatches
 * their native payload to the visible canvas center, the same drop path a
 * user drag reaches, without retaining the removed click-to-add shortcut. */
async function dropPaletteNode(page: Page, type: string, position?: { x: number; y: number }) {
  const canvasBox = await page.locator('node-editor').boundingBox()
  if (!canvasBox) throw new Error('Expected node-editor canvas')
  const point = position ?? { x: canvasBox.x + canvasBox.width / 2, y: canvasBox.y + canvasBox.height / 2 }
  await page.evaluate(({ type, x, y }) => {
    const editor = document.querySelector('scadlet-app')?.shadowRoot?.querySelector('node-editor')
    const canvas = editor?.shadowRoot?.querySelector('#canvas')
    if (!canvas) throw new Error('Expected node-editor canvas')
    const dataTransfer = new DataTransfer()
    dataTransfer.setData('application/x-scadlet-node-type', type)
    canvas.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, clientX: x, clientY: y, dataTransfer }))
    canvas.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, clientX: x, clientY: y, dataTransfer }))
  }, { type, ...point })
}

async function dropModuleCall(page: Page, definitionId: string, position?: { x: number; y: number }) {
  const canvasBox = await page.locator('node-editor').boundingBox()
  if (!canvasBox) throw new Error('Expected node-editor canvas')
  const point = position ?? { x: canvasBox.x + 40, y: canvasBox.y + canvasBox.height - 40 }
  await page.evaluate(({ definitionId, x, y }) => {
    const editor = document.querySelector('scadlet-app')?.shadowRoot?.querySelector('node-editor')
    const canvas = editor?.shadowRoot?.querySelector('#canvas')
    if (!canvas) throw new Error('Expected node-editor canvas')
    const dataTransfer = new DataTransfer()
    dataTransfer.setData('application/x-scadlet-module-call', definitionId)
    canvas.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, clientX: x, clientY: y, dataTransfer }))
    canvas.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, clientX: x, clientY: y, dataTransfer }))
  }, { definitionId, ...point })
}

async function dropFunctionCall(page: Page, definitionId: string, position: { x: number; y: number }) {
  await page.evaluate(({ definitionId, x, y }) => {
    const editor = document.querySelector('scadlet-app')?.shadowRoot?.querySelector('node-editor')
    const canvas = editor?.shadowRoot?.querySelector('#canvas')
    if (!canvas) throw new Error('Expected node-editor canvas')
    const dataTransfer = new DataTransfer()
    dataTransfer.setData('application/x-scadlet-function-call', definitionId)
    canvas.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, clientX: x, clientY: y, dataTransfer }))
    canvas.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, clientX: x, clientY: y, dataTransfer }))
  }, { definitionId, ...position })
}

async function definitionRuntime(page: Page, definitionId: string): Promise<{ inputsNodeId: string; outputNodeId: string }> {
  return page.locator('node-editor').evaluate((element, id) => {
    const definition = (element as unknown as { getEditorInstance(): { getDefinitions(): { id: string; inputsNodeId: string; outputNodeId: string }[] } }).getEditorInstance().getDefinitions().find((item) => item.id === id)
    if (!definition) throw new Error(`Missing definition ${id}`)
    return { inputsNodeId: definition.inputsNodeId, outputNodeId: definition.outputNodeId }
  }, definitionId)
}

async function callNodeIdsInScope(page: Page, label: string, scope: string | null): Promise<string[]> {
  return page.locator('node-editor').evaluate((element, input) => {
    const instance = (element as unknown as { getEditorInstance(): { editor: { getNodes(): { id: string; label: string }[] }; getNodeScope(id: string): string | null } }).getEditorInstance()
    return instance.editor.getNodes().filter((node) => node.label === input.label && instance.getNodeScope(node.id) === input.scope).map((node) => node.id)
  }, { label, scope })
}

async function dragNodeTo(page: Page, node: Locator, target: { x: number; y: number }) {
  const header = await node.locator('.node-header').boundingBox()
  if (!header) throw new Error('Expected node header')
  await page.mouse.move(header.x + 20, header.y + header.height / 2)
  await page.mouse.down()
  await page.mouse.move(target.x, target.y, { steps: 8 })
  await page.mouse.up()
}

async function connectSockets(page: Page, source: Locator, target: Locator) {
  const sourceBox = await waitForBoundingBox(source)
  const targetBox = await waitForBoundingBox(target)
  await page.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2)
  await page.mouse.down()
  await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height / 2, { steps: 8 })
  await page.mouse.up()
}

async function waitForBoundingBox(locator: Locator): Promise<{ x: number; y: number; width: number; height: number }> {
  await expect.poll(async () => Boolean(await locator.boundingBox())).toBe(true)
  const box = await locator.boundingBox()
  if (!box) throw new Error('Expected stable element bounds after render')
  return box
}

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    // Exercise SCADlet's baseline file-input/download implementation;
    // native picker UI cannot be driven portably in headless CI.
    Object.defineProperty(window, 'showOpenFilePicker', { value: undefined, configurable: true })
    Object.defineProperty(window, 'showSaveFilePicker', { value: undefined, configurable: true })
  })
})

test('header exposes the SCADlet GitHub link', async ({ page }) => {
  await waitForLocalLibrary(page)
  const link = page.getByRole('link', { name: 'SCADlet on GitHub' })
  await expect(link).toHaveAttribute('href', 'https://github.com/krichenbauer/scadlet')
  await expect(link).toHaveAttribute('target', '_blank')
  await expect(link).toHaveAttribute('rel', 'noopener noreferrer')
})

test('starts from the historical pre-Phase-4 v3 Module fixture without losing parameter ports or fallbacks', async ({ page }) => {
  await waitForLocalLibrary(page)
  const project = structuredClone(HISTORICAL_MODULE_PARAMETERS)
  await replaceLocalProjects(page, [{
    id: 'historical-module-project', revision: 7,
    createdAt: '2026-09-05T09:00:00.000Z', updatedAt: '2026-09-05T09:15:00.000Z', project,
  }], 'historical-module-project')

  await page.reload()
  await expect(page.locator('scadlet-app .project-picker')).toBeEnabled()
  await expect(page.locator('scadlet-app .project-picker')).toHaveValue('historical-module-project')
  const inputs = page.locator('node-editor .node[data-node-id="wheel-inputs"]')
  const call = page.locator('node-editor .node[data-node-id="main-wheel-call"]')
  await expect(inputs.locator('.node-port--output')).toHaveCount(4)
  await call.locator('.node-pin').click()
  await expect(call.locator('.node-param-row')).toHaveCount(3)
  await expect(page.locator('node-editor svg.connection[data-real-connection="true"]')).toHaveCount(3)

  const savedName = page.locator('scadlet-app .project-name')
  await savedName.fill('Historical wheel saved')
  await savedName.press('Tab')
  await expect(page.locator('scadlet-app .dirty-indicator')).toBeHidden({ timeout: 5_000 })
  const saved = await readLocalRecord(page, 'historical-module-project') as { revision: number; project: typeof HISTORICAL_MODULE_PARAMETERS }
  expect(saved.revision).toBeGreaterThan(7)
  expect(saved.project.definitions[0].parameters).toEqual(project.definitions[0].parameters)
  expect(saved.project.graph.nodes.find((node: { id: string }) => node.id === 'main-wheel-call').parameters.arguments).toEqual({
    'radius-id': 19, 'center-id': false, 'offset-id': [8, 9, 10],
  })
})

test('isolates a broken active record from the usable local library and never autosaves over it', async ({ page }) => {
  await waitForLocalLibrary(page)
  const broken = structuredClone(HISTORICAL_MODULE_PARAMETERS)
  broken.metadata.name = 'Broken recovery project'
  broken.definitions[0].parameters[0].type = 'unsupported'
  const valid = structuredClone(HISTORICAL_MODULE_PARAMETERS)
  valid.metadata.name = 'Valid recovery project'
  const brokenRecord = {
    id: 'broken-project', revision: 4,
    createdAt: '2026-09-05T09:00:00.000Z', updatedAt: '2026-09-05T09:15:00.000Z', project: broken,
  }
  await replaceLocalProjects(page, [
    brokenRecord,
    { id: 'valid-project', revision: 2, createdAt: '2026-09-05T09:00:00.000Z', updatedAt: '2026-09-05T09:16:00.000Z', project: valid },
  ], 'broken-project')

  await page.reload()
  await expect(page.locator('scadlet-app .project-picker')).toBeEnabled()
  await expect(page.locator('scadlet-app .project-picker option')).toHaveCount(2)
  await expect(page.locator('scadlet-app .persistence-status')).toContainText('Could not load local project "Broken recovery project"')
  await expect(page.locator('scadlet-app .persistence-status')).not.toContainText('storage is unavailable')
  await page.waitForTimeout(1_100)
  expect(await readLocalRecord(page, 'broken-project')).toEqual(brokenRecord)

  page.once('dialog', (dialog) => dialog.accept())
  await page.getByRole('button', { name: 'Delete', exact: true }).click()
  await expect(page.locator('scadlet-app .project-picker')).toHaveValue('valid-project')
  await expect(page.locator('scadlet-app .project-name')).toHaveValue('Valid recovery project')
  await expect(page.locator('scadlet-app .project-picker option')).toHaveCount(1)
  await page.getByRole('button', { name: 'New', exact: true }).click()
  await expect(page.locator('scadlet-app .project-picker option')).toHaveCount(2)
})

test('creates, displays, protects, and restores a Module definition', async ({ page }) => {
  await waitForLocalLibrary(page)
  const categoryTitles = await page.locator('node-palette .category-title').allTextContents()
  expect(categoryTitles.indexOf('My Modules')).toBeGreaterThan(categoryTitles.indexOf('Math'))
  await dropPaletteNode(page, 'cube')
  const cube = page.locator('node-editor .node').filter({ has: page.locator('.node-title', { hasText: 'Cube' }) })
  const cubeBefore = await cube.boundingBox()
  if (!cubeBefore) throw new Error('Expected Main Cube')
  await expect(page.getByText('My Modules', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '+ New module', exact: true }).click()
  const dialog = page.getByRole('form', { name: 'Create module' })
  await dialog.getByLabel('Module name').fill('wheel')
  await dialog.getByRole('button', { name: 'Create', exact: true }).click()

  await expect(page.locator('node-palette .module-item')).toHaveText('wheel')
  const frame = page.locator('node-editor .definition-frame[data-definition-id]')
  await expect(frame).toHaveCount(1)
  await expect(frame).toContainText('module wheel')
  const inputs = page.locator('node-editor .node').filter({ has: page.locator('.node-title', { hasText: 'Inputs' }) })
  const output = page.locator('node-editor .node').filter({ has: page.locator('.node-title', { hasText: 'Output' }) })
  await expect(inputs).toHaveCount(1)
  await expect(output).toHaveCount(1)
  await expect(output.locator('.node-port--input .node-socket[aria-label="Geometry"]')).toHaveCount(1)

  const title = frame.locator('.definition-frame-title')
  await expect(page.locator('scadlet-app .dirty-indicator')).toBeHidden({ timeout: 5_000 })
  await title.click()
  await expect(inputs).toHaveClass(/node--selected/)
  await expect(output).toHaveClass(/node--selected/)
  await expect(cube).not.toHaveClass(/node--selected/)
  await expect(page.locator('scadlet-app .dirty-indicator')).toBeHidden()

  const inputsBefore = await inputs.boundingBox()
  const outputBefore = await output.boundingBox()
  const titleBefore = await title.boundingBox()
  if (!inputsBefore || !outputBefore || !titleBefore) throw new Error('Expected Module frame and interface nodes')
  await page.mouse.move(titleBefore.x + 20, titleBefore.y + titleBefore.height / 2)
  await page.mouse.down()
  await page.mouse.move(titleBefore.x + 100, titleBefore.y + titleBefore.height / 2 + 60, { steps: 8 })
  await page.mouse.up()
  const inputsAfter = await inputs.boundingBox()
  const outputAfter = await output.boundingBox()
  const cubeAfter = await cube.boundingBox()
  const titleAfter = await title.boundingBox()
  if (!inputsAfter || !outputAfter || !cubeAfter || !titleAfter) throw new Error('Expected moved Module frame and nodes')
  expect(inputsAfter.x - inputsBefore.x).toBeCloseTo(80, 0)
  expect(inputsAfter.y - inputsBefore.y).toBeCloseTo(60, 0)
  expect(outputAfter.x - outputBefore.x).toBeCloseTo(80, 0)
  expect(outputAfter.y - outputBefore.y).toBeCloseTo(60, 0)
  expect(outputAfter.x - inputsAfter.x).toBeCloseTo(outputBefore.x - inputsBefore.x, 0)
  expect(outputAfter.y - inputsAfter.y).toBeCloseTo(outputBefore.y - inputsBefore.y, 0)
  expect(titleAfter.x - titleBefore.x).toBeCloseTo(80, 0)
  expect(titleAfter.y - titleBefore.y).toBeCloseTo(60, 0)
  expect(cubeAfter.x - cubeBefore.x).toBeCloseTo(0, 0)
  expect(cubeAfter.y - cubeBefore.y).toBeCloseTo(0, 0)

  await title.click()
  await page.keyboard.press('Delete')
  await expect(output).toHaveCount(1)
  await expect(inputs).toHaveCount(1)

  const canvas = await page.locator('node-editor').boundingBox()
  if (!canvas) throw new Error('Expected editor canvas')
  await page.mouse.click(canvas.x + 12, canvas.y + canvas.height - 12)
  const individualBefore = await inputs.boundingBox()
  const outputStillBefore = await output.boundingBox()
  const inputsHeader = await inputs.locator('.node-header').boundingBox()
  if (!individualBefore || !outputStillBefore || !inputsHeader) throw new Error('Expected movable Inputs node')
  await page.mouse.move(inputsHeader.x + 20, inputsHeader.y + inputsHeader.height / 2)
  await page.mouse.down()
  await page.mouse.move(inputsHeader.x + 60, inputsHeader.y + inputsHeader.height / 2, { steps: 5 })
  await page.mouse.up()
  const individualAfter = await inputs.boundingBox()
  const outputStillAfter = await output.boundingBox()
  if (!individualAfter || !outputStillAfter) throw new Error('Expected individually moved Inputs node')
  expect(individualAfter.x - individualBefore.x).toBeCloseTo(40, 0)
  expect(outputStillAfter.x - outputStillBefore.x).toBeCloseTo(0, 0)
  await expect(page.locator('scadlet-app .dirty-indicator')).toBeHidden({ timeout: 5_000 })
  await page.reload()
  await expect(page.locator('node-palette .module-item')).toHaveText('wheel')
  await expect(page.locator('node-editor .definition-frame')).toHaveCount(1)
  await expect(page.locator('node-editor .node').filter({ has: page.locator('.node-title', { hasText: 'Inputs' }) })).toHaveCount(1)
  await expect(page.locator('node-editor .node').filter({ has: page.locator('.node-title', { hasText: 'Output' }) })).toHaveCount(1)
})

test('creates, renders, inspects, and restores a parameterless Module Call', async ({ page }) => {
  await waitForLocalLibrary(page)
  await page.getByRole('button', { name: '+ New module', exact: true }).click()
  const dialog = page.getByRole('form', { name: 'Create module' })
  await dialog.getByLabel('Module name').fill('wheel')
  await dialog.getByRole('button', { name: 'Create', exact: true }).click()

  const frame = page.locator('node-editor .definition-frame[data-definition-id]')
  await expect(frame).toHaveCount(1)
  // A native palette drag is the one creation path that assigns the Module
  // scope. The later socket wire verifies that same-scope compatibility is
  // live rather than a visual-only frame.
  const initialFrameBox = await frame.boundingBox()
  if (!initialFrameBox) throw new Error('Expected Module frame')
  // Frames intentionally do not take pointer events, so dispatch the same
  // native drag payload to the real canvas position beneath the frame.
  await page.evaluate(({ x, y }) => {
    const editor = document.querySelector('scadlet-app')?.shadowRoot?.querySelector('node-editor')
    const canvas = editor?.shadowRoot?.querySelector('#canvas')
    if (!canvas) throw new Error('Expected node-editor canvas')
    const dataTransfer = new DataTransfer()
    dataTransfer.setData('application/x-scadlet-node-type', 'cube')
    canvas.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, clientX: x, clientY: y, dataTransfer }))
    canvas.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, clientX: x, clientY: y, dataTransfer }))
  }, { x: initialFrameBox.x + initialFrameBox.width / 2, y: initialFrameBox.y + initialFrameBox.height / 2 })
  const moduleCube = page.locator('node-editor .node').filter({ has: page.locator('.node-title', { hasText: 'Cube' }) })
  await expect(moduleCube).toHaveCount(1)
  const frameBox = await waitForBoundingBox(frame)
  const cubeBox = await waitForBoundingBox(moduleCube)
  expect(cubeBox.x).toBeGreaterThanOrEqual(frameBox.x)
  expect(cubeBox.y).toBeGreaterThanOrEqual(frameBox.y)
  const output = page.locator('node-editor .node').filter({ has: page.locator('.node-title', { hasText: 'Output' }) })
  const source = await moduleCube.locator('.node-port--output .node-socket[aria-label="Geometry"]').boundingBox()
  const target = await output.locator('.node-port--input .node-socket[aria-label="Geometry"]').boundingBox()
  if (!source || !target) throw new Error('Expected Module Cube and Output Geometry sockets')
  await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2)
  await page.mouse.down()
  await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 8 })
  await page.mouse.up()
  await expect(page.locator('node-editor svg.connection[data-real-connection="true"]')).toHaveCount(1)

  // Sidebar click remains an explicitly Main-only creation action and does
  // not create a second definition.
  const definitionId = await frame.getAttribute('data-definition-id')
  if (!definitionId) throw new Error('Expected Module definition id')
  await dropModuleCall(page, definitionId)
  const call = page.locator('node-editor .node').filter({ has: page.locator('.node-title', { hasText: 'wheel' }) })
  await expect(call).toHaveCount(1)
  await expect(call.locator('.node-port--output .node-socket[aria-label="Geometry"]')).toHaveCount(1)
  await page.getByRole('button', { name: 'Render', exact: true }).click()
  await expect(page.locator('scadlet-app .scad-output')).toContainText('module wheel()', { timeout: 15_000 })
  await expect(page.locator('scadlet-app .scad-output')).toContainText('cube();')
  await expect(page.locator('scadlet-app .scad-output')).toContainText('wheel();')
  await expect(page.getByRole('button', { name: 'Download .stl', exact: true })).toBeEnabled({ timeout: 15_000 })

  await call.locator('.node-header').dblclick()
  await expect(page.locator('scadlet-app .scad-output')).toContainText('module wheel()', { timeout: 15_000 })
  await expect(page.getByRole('button', { name: 'Download .stl', exact: true })).toBeEnabled()

  await expect(page.locator('scadlet-app .dirty-indicator')).toBeHidden({ timeout: 5_000 })
  await page.reload()
  await expect(page.locator('node-editor .definition-frame')).toHaveCount(1)
  await expect(page.locator('node-editor .node').filter({ has: page.locator('.node-title', { hasText: 'Cube' }) })).toHaveCount(1)
  await expect(page.locator('node-editor .node').filter({ has: page.locator('.node-title', { hasText: 'wheel' }) })).toHaveCount(1)
  await page.getByRole('button', { name: 'Render', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Download .stl', exact: true })).toBeEnabled({ timeout: 15_000 })
})

test('builds, rejects recursion in, autosaves, reloads, and renders nested Function Calls', async ({ page }) => {
  test.setTimeout(90_000)
  await waitForLocalLibrary(page)
  const editorBox = await page.locator('node-editor').boundingBox()
  if (!editorBox) throw new Error('Expected node editor')

  const createFunction = async (name: string) => {
    await page.getByRole('button', { name: '+ New function', exact: true }).click()
    const dialog = page.getByRole('form', { name: 'Create function' })
    await dialog.getByLabel('Function name').fill(name)
    await dialog.getByRole('button', { name: 'Create', exact: true }).click()
    const frame = page.locator('node-editor .definition-frame').filter({ hasText: `function ${name}` })
    await expect(frame).toHaveCount(1)
    const id = await frame.getAttribute('data-definition-id')
    if (!id) throw new Error(`Expected ${name} definition id`)
    return { frame, id, ...(await definitionRuntime(page, id)) }
  }

  const inner = await createFunction('inner')
  const innerBox = await inner.frame.boundingBox()
  if (!innerBox) throw new Error('Expected inner Function frame')
  await dropPaletteNode(page, 'number', { x: innerBox.x + innerBox.width / 2 - 70, y: innerBox.y + innerBox.height / 2 })
  const innerValue = page.locator('node-editor .node').filter({ has: page.locator('.node-header input[aria-label="Number Name"]') })
  const innerOutput = page.locator(`node-editor .node[data-node-id="${inner.outputNodeId}"]`)
  await connectSockets(page, innerValue.locator('.node-port--output .node-socket'), innerOutput.locator('.node-port--input .node-socket[aria-label="Result"]'))
  await expect(page.locator('node-palette .module-item').filter({ hasText: 'inner' })).toHaveAttribute('draggable', 'true')

  // Make room for the second definition while keeping the first frame in
  // view for the later indirect-cycle attempt.
  const innerTitle = await inner.frame.locator('.definition-frame-title').boundingBox()
  if (!innerTitle) throw new Error('Expected inner frame title')
  await page.mouse.move(innerTitle.x + 20, innerTitle.y + innerTitle.height / 2)
  await page.mouse.down()
  await page.mouse.move(innerTitle.x - 150, innerTitle.y - 170, { steps: 8 })
  await page.mouse.up()

  const outer = await createFunction('outer')
  const outerBox = await outer.frame.boundingBox()
  if (!outerBox) throw new Error('Expected outer Function frame')
  await dropFunctionCall(page, inner.id, { x: outerBox.x + outerBox.width / 2 - 70, y: outerBox.y + outerBox.height / 2 })
  const nestedInnerIds = await callNodeIdsInScope(page, 'inner', outer.id)
  expect(nestedInnerIds).toHaveLength(1)
  const nestedInnerCall = page.locator(`node-editor .node[data-node-id="${nestedInnerIds[0]}"]`)
  const outerOutput = page.locator(`node-editor .node[data-node-id="${outer.outputNodeId}"]`)
  await connectSockets(page, nestedInnerCall.locator('.node-port--output .node-socket'), outerOutput.locator('.node-port--input .node-socket[aria-label="Result"]'))
  await expect(page.locator('node-palette .module-item').filter({ hasText: 'outer' })).toHaveAttribute('draggable', 'true')

  // A direct recursive Call may be placed as a dead draft, but connecting it
  // to the effective body is rejected before the existing body wire changes.
  const liveConnections = page.locator('node-editor svg.connection[data-real-connection="true"]')
  await expect(liveConnections).toHaveCount(2)
  const expandedOuterBox = await outer.frame.boundingBox()
  if (!expandedOuterBox) throw new Error('Expected expanded outer frame')
  await dropFunctionCall(page, outer.id, { x: expandedOuterBox.x + expandedOuterBox.width / 2, y: expandedOuterBox.y + expandedOuterBox.height - 35 })
  const selfCallIds = await callNodeIdsInScope(page, 'outer', outer.id)
  expect(selfCallIds).toHaveLength(1)
  const selfCall = page.locator(`node-editor .node[data-node-id="${selfCallIds[0]}"]`)
  await connectSockets(page, selfCall.locator('.node-port--output .node-socket'), outerOutput.locator('.node-port--input .node-socket[aria-label="Result"]'))
  await expect(page.locator('node-editor .scope-transfer-feedback')).toContainText('Recursive Function dependencies are not supported yet')
  await expect(liveConnections).toHaveCount(2)

  // The same rejected preflight catches the indirect outer -> inner -> outer
  // cycle without replacing inner's literal result.
  const movedInnerBox = await inner.frame.boundingBox()
  if (!movedInnerBox) throw new Error('Expected moved inner frame')
  await dropFunctionCall(page, outer.id, { x: movedInnerBox.x + movedInnerBox.width / 2, y: movedInnerBox.y + movedInnerBox.height / 2 })
  const indirectCallIds = await callNodeIdsInScope(page, 'outer', inner.id)
  expect(indirectCallIds).toHaveLength(1)
  const indirectCall = page.locator(`node-editor .node[data-node-id="${indirectCallIds[0]}"]`)
  await connectSockets(page, indirectCall.locator('.node-port--output .node-socket'), innerOutput.locator('.node-port--input .node-socket[aria-label="Result"]'))
  await expect(liveConnections).toHaveCount(2)

  // Use outer in Main as a normal typed parameter source.
  await dropFunctionCall(page, outer.id, { x: editorBox.x + 35, y: editorBox.y + editorBox.height - 70 })
  await dropPaletteNode(page, 'cube', { x: editorBox.x + 270, y: editorBox.y + editorBox.height - 100 })
  const mainCallIds = await callNodeIdsInScope(page, 'outer', null)
  expect(mainCallIds).toHaveLength(1)
  const mainOuterCall = page.locator(`node-editor .node[data-node-id="${mainCallIds[0]}"]`)
  const cube = page.locator('node-editor .node').filter({ has: page.locator('.node-title', { hasText: 'Cube' }) })
  await cube.locator('.node-pin').click()
  await cube.getByText('+ Size', { exact: true }).click()
  await cube.getByRole('button', { name: 'Scalar', exact: true }).click()
  await connectSockets(page, mainOuterCall.locator('.node-port--output .node-socket'), cube.locator('.node-param-row', { hasText: 'Size' }).locator('.node-socket'))

  await page.getByRole('button', { name: 'Render', exact: true }).click()
  const source = page.locator('scadlet-app .scad-output')
  await expect(source).toContainText('function inner() = 10;', { timeout: 15_000 })
  await expect(source).toContainText('function outer() = inner();')
  await expect(source).toContainText('cube(outer());')
  const sourceText = await source.textContent()
  expect(sourceText!.indexOf('function inner')).toBeLessThan(sourceText!.indexOf('function outer'))
  await expect(page.getByRole('button', { name: 'Download .stl', exact: true })).toBeEnabled({ timeout: 15_000 })

  await expect(page.locator('scadlet-app .dirty-indicator')).toBeHidden({ timeout: 5_000 })
  await page.reload()
  await expect(page.locator('node-editor .definition-frame')).toHaveCount(2)
  await expect(page.locator('node-editor .node').filter({ has: page.locator('.node-title', { hasText: 'inner' }) })).toHaveCount(1)
  await expect(page.locator('node-editor .node').filter({ has: page.locator('.node-title', { hasText: 'outer' }) })).toHaveCount(3)
  await page.getByRole('button', { name: 'Render', exact: true }).click()
  await expect(page.locator('scadlet-app .scad-output')).toContainText('cube(outer());', { timeout: 15_000 })
  await expect(page.getByRole('button', { name: 'Download .stl', exact: true })).toBeEnabled({ timeout: 15_000 })
})

test('renders and restores a visible Compare-driven Conditional Function through real OpenSCAD-WASM', async ({ page }) => {
  test.setTimeout(60_000)
  await waitForLocalLibrary(page)
  await replaceLocalProjects(page, [{
    id: 'absolute-conditional', revision: 1,
    createdAt: '2026-09-09T00:00:00.000Z', updatedAt: '2026-09-09T00:00:00.000Z', project: absoluteConditionalProject(),
  }], 'absolute-conditional')
  await page.reload()
  const conditional = page.locator('node-editor .node[data-node-id="conditional"]')
  await expect(conditional.locator('.node-socket[data-socket-key="condition"]')).toHaveAttribute('data-socket-type', 'boolean')
  await expect(conditional.locator('.node-socket[data-socket-key="true"]')).toHaveAttribute('data-socket-type', 'number')
  await expect(conditional.locator('.node-socket[data-socket-key="false"]')).toHaveAttribute('data-socket-type', 'number')
  await expect(conditional.locator('.node-socket[data-socket-key="result"]')).toHaveAttribute('data-socket-type', 'number')
  await page.getByRole('button', { name: 'Render', exact: true }).click()
  const source = page.locator('scadlet-app .scad-output')
  await expect(source).toContainText('function absolute(x = 0) = ((x < 0) ? (x * -1) : x);', { timeout: 15_000 })
  await expect(source).toContainText('cube(absolute(x = 10));')
  await expect(page.getByRole('button', { name: 'Download .stl', exact: true })).toBeEnabled({ timeout: 15_000 })
  await expect(page.locator('scadlet-app .dirty-indicator')).toBeHidden({ timeout: 5_000 })
  await page.reload()
  await expect(page.locator('node-editor .node[data-node-id="conditional"] .node-socket[data-socket-key="result"]')).toHaveAttribute('data-socket-type', 'number')
  await page.getByRole('button', { name: 'Render', exact: true }).click()
  await expect(source).toContainText('function absolute(x = 0) = ((x < 0) ? (x * -1) : x);', { timeout: 15_000 })
  await expect(page.getByRole('button', { name: 'Download .stl', exact: true })).toBeEnabled({ timeout: 15_000 })
})

test('restores, renders, autosaves, and reloads Module bodies containing both Call kinds', async ({ page }) => {
  test.setTimeout(60_000)
  await waitForLocalLibrary(page)
  await replaceLocalProjects(page, [{
    id: 'nested-module-calls', revision: 1,
    createdAt: '2026-09-09T00:00:00.000Z', updatedAt: '2026-09-09T00:00:00.000Z', project: nestedModuleCallsProject(),
  }], 'nested-module-calls')
  await page.reload()
  const source = page.locator('scadlet-app .scad-output')
  await page.getByRole('button', { name: 'Render', exact: true }).click()
  await expect(source).toContainText('function diameter(r = 10) = (r * 2);', { timeout: 15_000 })
  await expect(source).toContainText('module inner(r = 10)')
  await expect(source).toContainText('module outer(r = 10)')
  await expect(source).toContainText('inner(r = diameter(r = r));')
  const sourceText = await source.textContent()
  expect(sourceText!.indexOf('function diameter')).toBeLessThan(sourceText!.indexOf('module inner'))
  expect(sourceText!.indexOf('module inner')).toBeLessThan(sourceText!.indexOf('module outer'))
  await expect(page.getByRole('button', { name: 'Download .stl', exact: true })).toBeEnabled({ timeout: 15_000 })
  await expect(page.locator('scadlet-app .dirty-indicator')).toBeHidden({ timeout: 5_000 })

  await page.reload()
  await expect(page.locator('node-editor .node[data-node-id="outer-module"] .node-socket[aria-label="r"]')).toHaveCount(1)
  await expect(page.locator('node-editor svg.connection[data-real-connection="true"]')).toHaveCount(7)
  await page.getByRole('button', { name: 'Render', exact: true }).click()
  await expect(source).toContainText('inner(r = diameter(r = r));', { timeout: 15_000 })
  await expect(page.getByRole('button', { name: 'Download .stl', exact: true })).toBeEnabled({ timeout: 15_000 })
})

test('rejects a recursive Module body connection without changing the canvas or generated source', async ({ page }) => {
  test.setTimeout(45_000)
  await waitForLocalLibrary(page)
  const project = {
    format: 'scadlet', version: 5, metadata: { name: 'Recursive Module draft' },
    graph: { nodes: [{ id: 'main-loop', type: 'module-call', position: { x: 500, y: 500 }, parameters: { definitionId: 'loop', arguments: {} } }], connections: [] },
    definitions: [{
      id: 'loop', kind: 'module', name: 'loop', interface: { inputs: 'loop-in', output: 'loop-out' }, parameters: [], geometryInputs: [],
      graph: { nodes: [
        { id: 'loop-in', type: 'module-inputs', position: { x: 50, y: 100 }, parameters: {} },
        { id: 'self-call', type: 'module-call', position: { x: 260, y: 100 }, parameters: { definitionId: 'loop', arguments: {} } },
        { id: 'loop-out', type: 'module-output', position: { x: 500, y: 100 }, parameters: {} },
      ], connections: [] },
    }], editor: { viewport: { x: 0, y: 0, zoom: 1 } }, viewer: { camera: CAMERA },
  }
  await replaceLocalProjects(page, [{
    id: 'recursive-module-draft', revision: 1,
    createdAt: '2026-09-09T00:00:00.000Z', updatedAt: '2026-09-09T00:00:00.000Z', project,
  }], 'recursive-module-draft')
  await page.reload()
  await page.getByRole('button', { name: 'Render', exact: true }).click()
  const source = page.locator('scadlet-app .scad-output')
  await expect(source).toContainText('module loop()', { timeout: 15_000 })
  const before = await source.textContent()
  const connections = page.locator('node-editor svg.connection[data-real-connection="true"]')
  await expect(connections).toHaveCount(0)
  const selfCall = page.locator('node-editor .node[data-node-id="self-call"]')
  const output = page.locator('node-editor .node[data-node-id="loop-out"]')
  await connectSockets(page, selfCall.locator('.node-port--output .node-socket[aria-label="Geometry"]'), output.locator('.node-port--input .node-socket[aria-label="Geometry"]'))
  await expect(page.locator('node-editor .scope-transfer-feedback')).toContainText('Recursive Module dependencies are not supported yet')
  await expect(connections).toHaveCount(0)
  await page.getByRole('button', { name: 'Render', exact: true }).click()
  await expect(source).toHaveText(before ?? '')
})

test('propagates nested Function result transitions and safely renames/deletes their callees', async ({ page }) => {
  test.setTimeout(60_000)
  await waitForLocalLibrary(page)
  const project = nestedFunctionProject()
  await replaceLocalProjects(page, [{
    id: 'nested-lifecycle', revision: 1,
    createdAt: '2026-09-09T00:00:00.000Z', updatedAt: '2026-09-09T00:00:00.000Z', project,
  }], 'nested-lifecycle')
  await page.reload()
  const connections = page.locator('node-editor svg.connection[data-real-connection="true"]')
  await expect(connections).toHaveCount(3)

  const innerEntry = page.locator('node-palette .module-entry[data-definition-id="inner"]')
  await innerEntry.getByRole('button', { name: 'Edit inner' }).click()
  const rename = page.getByRole('form', { name: 'Rename function' })
  await rename.getByLabel('Function name').fill('renamed')
  await rename.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.locator('node-editor .node[data-node-id="outer-call"] .node-title')).toHaveText('renamed')
  await page.getByRole('button', { name: 'Render', exact: true }).click()
  await expect(page.locator('scadlet-app .scad-output')).toContainText('function outer() = renamed();', { timeout: 15_000 })

  // Cancelling callee deletion leaves its nested Call and every wire intact.
  await page.evaluate(() => { Object.defineProperty(window, 'confirm', { configurable: true, value: () => false }) })
  await innerEntry.getByRole('button', { name: 'Delete renamed' }).click()
  await expect(page.locator('node-editor .definition-frame')).toHaveCount(2)
  await expect(connections).toHaveCount(3)

  // Changing the callee Number result to Boolean propagates the direct
  // outer result type, but only disconnects outer's now-incompatible Main
  // Cube Size wire. Cancellation is a complete no-op.
  const innerFrame = page.locator('node-editor .definition-frame[data-definition-id="inner"]')
  const innerBox = await innerFrame.boundingBox()
  if (!innerBox) throw new Error('Expected inner frame')
  await dropPaletteNode(page, 'boolean', { x: innerBox.x + innerBox.width / 2, y: innerBox.y + innerBox.height - 35 })
  const boolean = page.locator('node-editor .node').filter({ has: page.locator('.node-header input[aria-label="Boolean Name"]') })
  const innerOutput = page.locator('node-editor .node[data-node-id="inner-out"]')
  await expect(page.locator('scadlet-app .dirty-indicator')).toBeHidden({ timeout: 5_000 })
  await connectSockets(page, boolean.locator('.node-port--output .node-socket'), innerOutput.locator('.node-port--input .node-socket'))
  await expect(connections).toHaveCount(3)
  let saved = await readLocalRecord(page, 'nested-lifecycle') as { project: ReturnType<typeof nestedFunctionProject> }
  expect(saved.project.definitions.map((item) => item.resultType)).toEqual(['number', 'number'])

  await page.evaluate(() => { Object.defineProperty(window, 'confirm', { configurable: true, value: () => true }) })
  await connectSockets(page, boolean.locator('.node-port--output .node-socket'), innerOutput.locator('.node-port--input .node-socket'))
  await expect(connections).toHaveCount(2)
  await expect(page.locator('scadlet-app .dirty-indicator')).toBeHidden({ timeout: 5_000 })
  saved = await readLocalRecord(page, 'nested-lifecycle') as { project: ReturnType<typeof nestedFunctionProject> }
  expect(saved.project.definitions.map((item) => item.resultType)).toEqual(['boolean', 'boolean'])
  expect(saved.project.graph.connections.map((item) => item.id)).not.toContain('main-size')
  expect(saved.project.definitions[0].graph.connections.map((item) => item.id)).toContain('outer-result')

  // An apply-time failure after one removal rolls the exact nested wire back
  // and leaves the registry/result types untouched.
  await page.locator('node-editor').evaluate((element) => {
    const editor = (element as unknown as { getEditorInstance(): { editor: { removeConnection(id: string): Promise<boolean> } } }).getEditorInstance().editor
    const original = editor.removeConnection.bind(editor)
    let attempts = 0
    editor.removeConnection = async (id: string) => {
      attempts += 1
      if (attempts === 2) {
        editor.removeConnection = original
        return false
      }
      return original(id)
    }
  })
  await innerEntry.getByRole('button', { name: 'Delete renamed' }).click()
  await expect(page.locator('node-editor .definition-frame')).toHaveCount(2)
  await expect(page.locator('node-editor .node[data-node-id="outer-call"]')).toHaveCount(1)
  await expect(connections).toHaveCount(2)

  // The explicit "disconnect the sole Function Output result" flow also
  // cascades through nested Calls. Cancellation preserves both wires and
  // types; confirmation unresolves inner and outer and persists their
  // disconnected Call drafts.
  const innerResultConnectionId = await page.locator('node-editor').evaluate((element) => {
    const editor = (element as unknown as { getEditorInstance(): { editor: { getConnections(): { id: string; target: string }[] } } }).getEditorInstance().editor
    const connection = editor.getConnections().find((item) => item.target === 'inner-out')
    if (!connection) throw new Error('Expected inner result connection')
    return connection.id
  })
  const innerResultHit = page.locator(`node-editor .connection[data-connection-id="${innerResultConnectionId}"] .connection-hit-path`)
  await innerResultHit.dispatchEvent('pointerdown', { button: 0 })
  await page.evaluate(() => { Object.defineProperty(window, 'confirm', { configurable: true, value: () => false }) })
  await page.keyboard.press('Delete')
  await expect(connections).toHaveCount(2)
  await page.evaluate(() => { Object.defineProperty(window, 'confirm', { configurable: true, value: () => true }) })
  await innerResultHit.dispatchEvent('pointerdown', { button: 0 })
  await page.keyboard.press('Delete')
  await expect(connections).toHaveCount(0)
  await expect(page.locator('scadlet-app .dirty-indicator')).toBeHidden({ timeout: 5_000 })
  saved = await readLocalRecord(page, 'nested-lifecycle') as { project: ReturnType<typeof nestedFunctionProject> }
  expect(saved.project.definitions.map((item) => item.resultType)).toEqual([undefined, undefined])

  // Confirmed deletion removes the nested callee Call, unresolves outer,
  // and leaves its existing disconnected Main Call as a restorable draft.
  await innerEntry.getByRole('button', { name: 'Delete renamed' }).click()
  await expect(page.locator('node-editor .definition-frame')).toHaveCount(1)
  await expect(page.locator('node-editor .node[data-node-id="outer-call"]')).toHaveCount(0)
  await expect(connections).toHaveCount(0)
  await expect(page.locator('scadlet-app .dirty-indicator')).toBeHidden({ timeout: 5_000 })
  saved = await readLocalRecord(page, 'nested-lifecycle') as { project: ReturnType<typeof nestedFunctionProject> }
  expect(saved.project.definitions).toHaveLength(1)
  expect(saved.project.definitions[0].id).toBe('outer')
  expect(saved.project.definitions[0].resultType).toBeUndefined()
  expect(saved.project.graph.nodes.map((item) => item.id)).toContain('main-outer-call')
  await page.reload()
  await expect(page.locator('node-editor .definition-frame[data-definition-id="outer"]')).toHaveCount(1)
  await expect(page.locator('node-editor .node[data-node-id="main-outer-call"] .node-port--output .node-socket')).toHaveAttribute('data-socket-type', 'unresolved')
})

test('transfers ordinary nodes between Main and Module scopes only on drop', async ({ page }) => {
  await waitForLocalLibrary(page)
  const editorBox = await page.locator('node-editor').boundingBox()
  if (!editorBox) throw new Error('Expected node editor')
  await page.getByRole('button', { name: '+ New module', exact: true }).click()
  let dialog = page.getByRole('form', { name: 'Create module' })
  await dialog.getByLabel('Module name').fill('wheel')
  await dialog.getByRole('button', { name: 'Create', exact: true }).click()
  const wheel = page.locator('node-editor .definition-frame').filter({ hasText: 'module wheel' })
  const wheelId = await wheel.getAttribute('data-definition-id')
  if (!wheelId) throw new Error('Expected wheel definition id')

  // Create Sphere directly inside the Module. Its initial scope makes this a
  // regression test for the former "own frame follows the node" trap: moving
  // it away must leave a stable source boundary and permit a Main drop.
  const initialWheelBox = await wheel.boundingBox()
  if (!initialWheelBox) throw new Error('Expected Module frame')
  await dropPaletteNode(page, 'sphere', { x: initialWheelBox.x + initialWheelBox.width / 2, y: initialWheelBox.y + initialWheelBox.height / 2 })
  const sphere = page.locator('node-editor .node').filter({ has: page.locator('.node-title', { hasText: 'Sphere' }) })
  await wheel.locator('.definition-frame-title').click()
  await expect(sphere).toHaveClass(/node--selected/)

  // Clear the header's complete Module selection so direct node dragging
  // moves just Sphere rather than the whole definition.
  await page.mouse.click(editorBox.x + editorBox.width - 12, editorBox.y + editorBox.height - 12)
  // Selection clearing re-renders both the frame and node. Wait through that
  // brief unmount/remount instead of sampling a transient null box.
  await expect.poll(async () => Boolean(await wheel.boundingBox())).toBe(true)
  await expect.poll(async () => Boolean(await sphere.locator('.node-header').boundingBox())).toBe(true)
  const wheelBox = await wheel.boundingBox()
  const header = await sphere.locator('.node-header').boundingBox()
  if (!wheelBox || !header) throw new Error('Expected Sphere and Module frame')
  const mainDrop = { x: editorBox.x + 40, y: editorBox.y + editorBox.height - 80 }
  await page.mouse.move(header.x + 20, header.y + header.height / 2)
  await page.mouse.down()
  await page.mouse.move(mainDrop.x, mainDrop.y, { steps: 8 })
  const sourceFrameWhileDragging = await wheel.boundingBox()
  if (!sourceFrameWhileDragging) throw new Error('Expected stable Module frame during drag')
  expect(sourceFrameWhileDragging.x).toBeCloseTo(wheelBox.x, 0)
  expect(sourceFrameWhileDragging.y).toBeCloseTo(wheelBox.y, 0)
  expect(sourceFrameWhileDragging.width).toBeCloseTo(wheelBox.width, 0)
  expect(sourceFrameWhileDragging.height).toBeCloseTo(wheelBox.height, 0)
  await page.mouse.up()
  const mainAfter = await sphere.boundingBox()
  if (!mainAfter) throw new Error('Expected Sphere returned to Main')
  expect(mainAfter.x).toBeLessThan(wheelBox.x)
  await wheel.locator('.definition-frame-title').click()
  await expect(sphere).not.toHaveClass(/node--selected/)

  // The inverse path remains supported: after its successful Main drop, the
  // same ordinary node can be assigned back to the Module by a later drag.
  const currentWheelBox = await wheel.boundingBox()
  if (!currentWheelBox) throw new Error('Expected Module frame')
  await dragNodeTo(page, sphere, { x: currentWheelBox.x + currentWheelBox.width / 2, y: currentWheelBox.y + currentWheelBox.height / 2 })
  await wheel.locator('.definition-frame-title').click()
  await expect(sphere).toHaveClass(/node--selected/)

  // A sidebar item is now only a draggable source. Its click is inert.
  await page.locator('node-palette .module-entry[data-definition-id] .module-item').click()
  await expect(page.locator('node-editor .node').filter({ has: page.locator('.node-title', { hasText: 'wheel' }) })).toHaveCount(0)
  await page.locator('node-palette .node-item').filter({ hasText: 'Cube' }).click()
  await expect(page.locator('node-editor .node').filter({ has: page.locator('.node-title', { hasText: 'Cube' }) })).toHaveCount(0)

  await dropModuleCall(page, wheelId, { x: editorBox.x + 40, y: editorBox.y + editorBox.height - 40 })
  await expect(page.locator('node-editor .node').filter({ has: page.locator('.node-title', { hasText: 'wheel' }) })).toHaveCount(1)
})

test('adds a typed Module parameter and materializes matching border-anchored Call input', async ({ page }) => {
  await waitForLocalLibrary(page)
  const editorBox = await page.locator('node-editor').boundingBox()
  if (!editorBox) throw new Error('Expected node editor')
  await page.getByRole('button', { name: '+ New module', exact: true }).click()
  const dialog = page.getByRole('form', { name: 'Create module' })
  await dialog.getByLabel('Module name').fill('ball')
  await dialog.getByRole('button', { name: 'Create', exact: true }).click()
  const frame = page.locator('node-editor .definition-frame').filter({ hasText: 'module ball' })
  const definitionId = await frame.getAttribute('data-definition-id')
  if (!definitionId) throw new Error('Expected Module definition id')
  const inputs = page.locator('node-editor .node').filter({ has: page.locator('.node-title', { hasText: 'Inputs' }) })
  await inputs.getByRole('button', { name: '+ Parameter', exact: true }).click()
  await inputs.getByLabel('Name').fill('radius')
  await inputs.getByLabel('Type').selectOption('number')
  await inputs.getByLabel('Default').fill('10')
  await inputs.getByRole('button', { name: 'Add', exact: true }).click()
  const outputSocket = inputs.locator('.node-param-output-row .node-socket[aria-label="radius"]')
  await expect(outputSocket).toHaveCount(1)
  const inputBox = await inputs.boundingBox(); const outputBox = await outputSocket.boundingBox()
  if (!inputBox || !outputBox) throw new Error('Expected Inputs socket bounds')
  expect(outputBox.x).toBeGreaterThan(inputBox.x + inputBox.width - 16)

  await dropModuleCall(page, definitionId, { x: editorBox.x + 50, y: editorBox.y + editorBox.height - 60 })
  const call = page.locator('node-editor .node').filter({ has: page.locator('.node-title', { hasText: 'ball' }) })
  await call.locator('.node-pin').click()
  const inputSocket = call.locator('.node-param-row', { hasText: 'radius' }).locator('.node-socket')
  await expect(inputSocket).toHaveCount(1)
  const callBox = await call.boundingBox(); const callInputBox = await inputSocket.boundingBox()
  if (!callBox || !callInputBox) throw new Error('Expected Call socket bounds')
  expect(callInputBox.x).toBeLessThan(callBox.x + 8)
  await expect(call.locator('.node-param-row input[type="number"]')).toHaveValue('10')
})

test('two Geometry inputs with the second wired to Output render exactly one Geometry socket per built-in node and generate children(1);', async ({ page }) => {
  // Regression for the reported screenshot bug: Cube/Sphere gaining a
  // second (unusable) Geometry output socket, and a direct Module Inputs
  // Geometry input -> Module Output connection producing an empty body.
  await waitForLocalLibrary(page)
  const editorBox = await page.locator('node-editor').boundingBox()
  if (!editorBox) throw new Error('Expected node editor')
  await page.getByRole('button', { name: '+ New module', exact: true }).click()
  const dialog = page.getByRole('form', { name: 'Create module' })
  await dialog.getByLabel('Module name').fill('test123')
  await dialog.getByRole('button', { name: 'Create', exact: true }).click()
  const frame = page.locator('node-editor .definition-frame').filter({ hasText: 'module test123' })
  const definitionId = await frame.getAttribute('data-definition-id')
  if (!definitionId) throw new Error('Expected Module definition id')
  const inputs = page.locator('node-editor .node').filter({ has: page.locator('.node-title', { hasText: 'Inputs' }) })
  const output = page.locator('node-editor .node').filter({ has: page.locator('.node-title', { hasText: 'Output' }) })

  await inputs.getByRole('button', { name: '+ Geometry input', exact: true }).click()
  await inputs.getByLabel('Geometry input name').fill('Fnord')
  await inputs.getByRole('button', { name: 'Add', exact: true }).click()
  await inputs.getByRole('button', { name: 'Edit Geometry 1', exact: true }).click()
  await inputs.getByLabel('Geometry input name').fill('Foobar')
  await inputs.getByRole('button', { name: 'Save', exact: true }).click()
  await inputs.getByRole('button', { name: '+ Parameter', exact: true }).click()
  await inputs.getByLabel('Name').fill('foo')
  await inputs.getByLabel('Default').fill('-2')
  await inputs.getByRole('button', { name: 'Add', exact: true }).click()

  // No duplicate/extra rows: exactly 2 Geometry + 1 typed parameter output, in order.
  await expect(inputs.locator('.node-port--output')).toHaveCount(3)
  await expect(inputs.locator('.node-geometry-output-rows .node-socket')).toHaveCount(2)
  const geometryLabels = await inputs.locator('.node-geometry-output-rows .node-socket').evaluateAll(
    (nodes) => nodes.map((node) => node.getAttribute('aria-label')),
  )
  expect(geometryLabels).toEqual(['Foobar', 'Fnord'])

  await connectSockets(
    page,
    inputs.locator('.node-geometry-output-rows .node-socket[aria-label="Fnord"]'),
    output.locator('.node-port--input .node-socket[aria-label="Geometry"]'),
  )
  await expect(page.locator('node-editor svg.connection[data-real-connection="true"]')).toHaveCount(1)

  await dropModuleCall(page, definitionId)
  const call = page.locator('node-editor .node').filter({ has: page.locator('.node-title', { hasText: 'test123' }) })
  // Placed relative to the frame's current bounds (grown by the signature
  // edits above), well clear of it and of each other/pane edges - avoids
  // the known "socket sits under an invisible pane overlap zone" gotcha.
  const frameBox = await waitForBoundingBox(frame)
  await dropPaletteNode(page, 'cube', { x: editorBox.x + 40, y: frameBox.y + frameBox.height + 60 })
  const cube = page.locator('node-editor .node').filter({ has: page.locator('.node-title', { hasText: 'Cube' }) })
  await dropPaletteNode(page, 'sphere', { x: editorBox.x + 40, y: frameBox.y + frameBox.height + 180 })
  const sphere = page.locator('node-editor .node').filter({ has: page.locator('.node-title', { hasText: 'Sphere' }) })

  // The core regression assertion: built-in nodes keep exactly one Geometry output.
  await expect(cube.locator('.node-port--output .node-socket[aria-label="Geometry"]')).toHaveCount(1)
  await expect(sphere.locator('.node-port--output .node-socket[aria-label="Geometry"]')).toHaveCount(1)
  await expect(call.locator('.node-port--input .node-socket[aria-label="Foobar"]')).toHaveCount(1)
  await expect(call.locator('.node-port--input .node-socket[aria-label="Fnord"]')).toHaveCount(1)
  await expect(call.locator('.node-port--output .node-socket[aria-label="Geometry"]')).toHaveCount(1)

  await connectSockets(
    page,
    cube.locator('.node-port--output .node-socket[aria-label="Geometry"]'),
    call.locator('.node-port--input .node-socket[aria-label="Foobar"]'),
  )
  await connectSockets(
    page,
    sphere.locator('.node-port--output .node-socket[aria-label="Geometry"]'),
    call.locator('.node-port--input .node-socket[aria-label="Fnord"]'),
  )
  await expect(page.locator('node-editor svg.connection[data-real-connection="true"]')).toHaveCount(3)

  await page.getByRole('button', { name: 'Render', exact: true }).click()
  await expect(page.locator('scadlet-app .scad-output')).toContainText('module test123(foo = -2)', { timeout: 15_000 })
  await expect(page.locator('scadlet-app .scad-output')).toContainText('children(1);')
  await expect(page.locator('scadlet-app .scad-output')).toContainText('cube();')
  await expect(page.locator('scadlet-app .scad-output')).toContainText('sphere();')
  await expect(page.getByRole('button', { name: 'Download .stl', exact: true })).toBeEnabled({ timeout: 15_000 })

  // Reload after autosave: sockets and codegen must not duplicate on restore.
  await expect(page.locator('scadlet-app .dirty-indicator')).toBeHidden({ timeout: 5_000 })
  await page.reload()
  await expect(inputs.locator('.node-port--output')).toHaveCount(3)
  await expect(cube.locator('.node-port--output .node-socket[aria-label="Geometry"]')).toHaveCount(1)
  await expect(sphere.locator('.node-port--output .node-socket[aria-label="Geometry"]')).toHaveCount(1)
  await expect(call.locator('.node-port--input .node-socket[aria-label="Foobar"]')).toHaveCount(1)
  await expect(call.locator('.node-port--input .node-socket[aria-label="Fnord"]')).toHaveCount(1)
  await page.getByRole('button', { name: 'Render', exact: true }).click()
  await expect(page.locator('scadlet-app .scad-output')).toContainText('children(1);', { timeout: 15_000 })
  await expect(page.getByRole('button', { name: 'Download .stl', exact: true })).toBeEnabled({ timeout: 15_000 })
})

test('renames and deletes a Module through its sidebar actions', async ({ page }) => {
  await waitForLocalLibrary(page)
  await page.getByRole('button', { name: '+ New module', exact: true }).click()
  const dialog = page.getByRole('form', { name: 'Create module' })
  await dialog.getByLabel('Module name').fill('wheel')
  await dialog.getByRole('button', { name: 'Create', exact: true }).click()
  const entry = page.locator('node-palette .module-entry[data-definition-id]')
  await entry.getByRole('button', { name: 'Edit wheel' }).click()
  const rename = page.getByRole('form', { name: 'Rename module' })
  await rename.getByLabel('Module name').fill('rim')
  await rename.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(entry.locator('.module-item')).toHaveText('rim')
  await expect(page.locator('node-editor .definition-frame')).toContainText('module rim')
  await expect(page.locator('scadlet-app .dirty-indicator')).toBeHidden({ timeout: 5_000 })
  await page.reload()
  await expect(page.locator('node-palette .module-item')).toHaveText('rim')
  page.once('dialog', (confirm) => confirm.accept())
  await entry.getByRole('button', { name: 'Delete rim' }).click()
  await expect(page.locator('node-palette .module-item')).toHaveCount(0)
  await expect(page.locator('node-editor .definition-frame')).toHaveCount(0)
  await expect(page.locator('scadlet-app .dirty-indicator')).toBeHidden({ timeout: 5_000 })
  await page.reload()
  await expect(page.locator('node-palette .module-item')).toHaveCount(0)
})

test('deletes a connected Module parameter only after confirmation and persists every projected removal', async ({ page }) => {
  await waitForLocalLibrary(page)
  const project = structuredClone(HISTORICAL_MODULE_PARAMETERS)
  project.editor.viewport = { x: 0, y: 0, zoom: 1 }
  project.graph.nodes[0].position = { x: 40, y: 420 }
  project.graph.nodes[1].position = { x: 280, y: 420 }
  project.definitions[0].graph.nodes[0].position = { x: 80, y: 140 }
  project.definitions[0].graph.nodes[1].position = { x: 320, y: 140 }
  project.definitions[0].graph.nodes[2].position = { x: 580, y: 140 }
  project.graph.nodes.push(
    { id: 'second-radius-source', type: 'number', position: { x: 40, y: 560 }, parameters: { value: 42, name: 'Second radius' } },
    {
      id: 'second-wheel-call', type: 'module-call', position: { x: 280, y: 560 },
      parameters: { definitionId: 'definition-wheel', arguments: { 'radius-id': 23, 'center-id': true, 'offset-id': [4, 5, 6] } },
    },
  )
  project.graph.connections.push({
    id: 'second-call-radius-wire', source: 'second-radius-source', sourceOutput: 'value', target: 'second-wheel-call', targetInput: 'parameter:radius-id',
  })
  await replaceLocalProjects(page, [{
    id: 'delete-parameter-project', revision: 4,
    createdAt: '2026-09-05T09:00:00.000Z', updatedAt: '2026-09-05T09:15:00.000Z', project,
  }], 'delete-parameter-project')
  await page.reload()

  const inputs = page.locator('node-editor .node[data-node-id="wheel-inputs"]')
  const firstCall = page.locator('node-editor .node[data-node-id="main-wheel-call"]')
  const secondCall = page.locator('node-editor .node[data-node-id="second-wheel-call"]')
  await firstCall.locator('.node-pin').click()
  await secondCall.locator('.node-pin').click()
  await expect(page.locator('node-editor svg.connection[data-real-connection="true"]')).toHaveCount(4)
  await inputs.getByRole('button', { name: 'Edit radius' }).click()

  // Cancelling is a true no-op: the parameter editor stays open so the user
  // can reconsider, and none of its exact connections have been touched.
  await page.evaluate(() => {
    Object.defineProperty(window, 'confirm', { configurable: true, value: (message: string) => {
      document.documentElement.dataset.lastConfirmation = message
      return false
    } })
  })
  await inputs.locator('.node-control--module-parameter').getByRole('button', { name: 'Delete', exact: true }).click()
  expect(await page.locator('html').getAttribute('data-last-confirmation')).toContain('disconnect 3 connection(s)')
  await expect(inputs.locator('.node-control--module-parameter').getByRole('button', { name: 'Delete', exact: true })).toBeVisible()
  await expect(inputs.locator('.node-param-output-row .node-socket[aria-label="radius"]')).toHaveCount(1)
  await expect(page.locator('node-editor svg.connection[data-real-connection="true"]')).toHaveCount(4)

  await page.evaluate(() => {
    Object.defineProperty(window, 'confirm', { configurable: true, value: () => true })
  })
  await inputs.locator('.node-control--module-parameter').getByRole('button', { name: 'Delete', exact: true }).click()
  await expect(inputs.locator('.node-param-output-row .node-socket[aria-label="radius"]')).toHaveCount(0)
  await expect(firstCall.locator('.node-param-row', { hasText: 'radius' })).toHaveCount(0)
  await expect(secondCall.locator('.node-param-row', { hasText: 'radius' })).toHaveCount(0)
  // The Module body wire is unrelated and remains intact.
  await expect(page.locator('node-editor svg.connection[data-real-connection="true"]')).toHaveCount(1)
  await expect(page.locator('scadlet-app .dirty-indicator')).toBeHidden({ timeout: 5_000 })

  const saved = await readLocalRecord(page, 'delete-parameter-project') as { project: typeof project }
  expect(saved.project.definitions[0].parameters.map((parameter: { id: string }) => parameter.id)).not.toContain('radius-id')
  expect(saved.project.graph.connections.map((connection: { id: string }) => connection.id)).not.toContain('call-radius-wire')
  expect(saved.project.graph.connections.map((connection: { id: string }) => connection.id)).not.toContain('second-call-radius-wire')
  expect(saved.project.definitions[0].graph.connections.map((connection: { id: string }) => connection.id)).toContain('wheel-body-wire')
  await page.reload()
  await expect(inputs.locator('.node-param-output-row .node-socket[aria-label="radius"]')).toHaveCount(0)
  await expect(page.locator('node-editor svg.connection[data-real-connection="true"]')).toHaveCount(1)
})

test('keeps Module parameter editing open and shows a localized error when deletion cannot start', async ({ page }) => {
  await waitForLocalLibrary(page)
  const project = structuredClone(HISTORICAL_MODULE_PARAMETERS)
  project.editor.viewport = { x: 0, y: 0, zoom: 1 }
  project.graph.nodes[0].position = { x: 40, y: 420 }
  project.graph.nodes[1].position = { x: 280, y: 420 }
  project.definitions[0].graph.nodes[0].position = { x: 80, y: 140 }
  project.definitions[0].graph.nodes[1].position = { x: 320, y: 140 }
  project.definitions[0].graph.nodes[2].position = { x: 580, y: 140 }
  await replaceLocalProjects(page, [{
    id: 'delete-parameter-error-project', revision: 1,
    createdAt: '2026-09-05T09:00:00.000Z', updatedAt: '2026-09-05T09:15:00.000Z', project,
  }], 'delete-parameter-error-project')
  await page.reload()
  const inputs = page.locator('node-editor .node[data-node-id="wheel-inputs"]')
  await inputs.getByRole('button', { name: 'Edit radius' }).click()
  await page.evaluate(() => {
    Object.defineProperty(window, 'confirm', { configurable: true, value: () => { throw new Error('simulated confirmation failure') } })
  })
  await inputs.locator('.node-control--module-parameter').getByRole('button', { name: 'Delete', exact: true }).click()
  await expect(inputs.getByText('Could not delete this Module parameter. No changes were made.')).toBeVisible()
  await expect(inputs.locator('.node-control--module-parameter').getByRole('button', { name: 'Delete', exact: true })).toBeVisible()
  await expect(inputs.locator('.node-param-output-row .node-socket[aria-label="radius"]')).toHaveCount(1)
})

test('Cube Size add menu exposes one selected representation at a time', async ({ page }) => {
  await waitForLocalLibrary(page)
  await dropPaletteNode(page, 'cube')
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
  await dropPaletteNode(page, 'translate')
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

  await dropPaletteNode(page, 'cube')
  const cube = page.locator('node-editor .node').filter({ has: page.locator('.node-title', { hasText: 'Cube' }) })
  await cube.locator('.node-pin').click()
  await cube.getByRole('button', { name: '+ Center', exact: true }).click()
  await expect(cube.locator('[data-param-key="center"] input[type="checkbox"]')).toHaveCount(1)
  await expect(cube.locator('[data-param-key="center"] .node-socket[data-socket-type="boolean"]')).toHaveCount(1)
})

test('variadic Boolean nodes use compact localized child affordances', async ({ page }) => {
  await waitForLocalLibrary(page)
  await dropPaletteNode(page, 'union')
  const union = page.locator('node-editor .node').filter({ has: page.locator('.node-title', { hasText: 'Union' }) })
  await expect(union.locator('.node-port-label')).toHaveText('+')
  await expect(union.locator('.node-socket[aria-label="Add geometry child"]')).toHaveCount(1)
  await expect(union.getByText('Geometry child', { exact: true })).toHaveCount(0)

  await dropPaletteNode(page, 'intersection')
  const intersection = page.locator('node-editor .node').filter({ has: page.locator('.node-title', { hasText: 'Intersection' }) })
  await expect(intersection.locator('.node-port-label')).toHaveText('+')
  await expect(intersection.locator('.node-socket[aria-label="Add geometry child"]')).toHaveCount(1)
})

test('typed value nodes remain compact and a Number drives Cube Size', async ({ page }) => {
  await waitForLocalLibrary(page)
  await dropPaletteNode(page, 'number')
  await dropPaletteNode(page, 'cube')
  const number = page.locator('node-editor .node').filter({ has: page.locator('.node-header input.node-title') })
  const cube = page.locator('node-editor .node').filter({ has: page.locator('.node-title', { hasText: 'Cube' }) })
  await expect(number.locator('.node-controls--primary input[type="number"]')).toBeVisible()
  await expect(number.locator('.node-header input.node-title')).toHaveValue('Number')
  await expect(number.locator('.node-controls--primary input[type="text"]')).toHaveCount(0)
  await expect(number.locator('.node-controls--primary .node-control-label')).toHaveCount(0)
  await expect(number.locator('.node-port--output .node-port-label')).toHaveCount(0)
  await expect(number.locator('.node-port--output .node-socket[aria-label="Number output"]')).toHaveCount(1)
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
  await expect(cube.locator('[data-param-key="size"] input')).toHaveValue('')

  await page.getByRole('button', { name: 'Render', exact: true }).click()
  await expect(page.locator('scadlet-app .scad-output')).toContainText('cube(20);', { timeout: 15_000 })
})

test('source names persist and value Inspect evaluates Add headlessly through OpenSCAD', async ({ page }) => {
  await waitForLocalLibrary(page)
  await dropPaletteNode(page, 'number')
  const number = page.locator('node-editor .node').filter({ has: page.locator('.node-header input.node-title') })
  await number.locator('.node-header input.node-title').fill('Width')
  await number.locator('.node-header input.node-title').press('Tab')
  await expect(page.locator('scadlet-app .dirty-indicator')).toBeHidden({ timeout: 5_000 })
  await page.reload()
  const restoredNumber = page.locator('node-editor .node').filter({ has: page.locator('.node-header input.node-title') })
  await expect(restoredNumber.locator('.node-header input.node-title')).toHaveValue('Width')
  // The title input itself is editable and protected from Inspect; a
  // double-click elsewhere in the source node starts a one-shot value Inspect.
  await restoredNumber.locator('.node-header input.node-title').dblclick()
  await expect(restoredNumber.locator('.node-inspect-value')).toHaveCount(0)
  await restoredNumber.locator('.node-controls--primary').dblclick({ position: { x: 2, y: 2 } })
  await expect(restoredNumber.locator('.node-inspect-value')).toHaveText('= 10', { timeout: 15_000 })

  await dropPaletteNode(page, 'add')
  const add = page.locator('node-editor .node').filter({ has: page.locator('.node-title', { hasText: 'Add' }) })
  await add.locator('.node-pin').click()
  await add.locator('[data-param-key="a"] input').fill('5')
  await add.locator('[data-param-key="b"] input').fill('7')
  await add.locator('.node-header').dblclick()
  await expect(add.locator('.node-inspect-value')).toHaveText('= 12', { timeout: 15_000 })
  await add.locator('[data-param-key="a"] input').fill('10')
  await expect(add.locator('.node-inspect-value')).toHaveCount(0)
  await page.waitForTimeout(500)
  await expect(add.locator('.node-inspect-value')).toHaveCount(0)
  await add.locator('.node-header').dblclick()
  await expect(add.locator('.node-inspect-value')).toHaveText('= 17', { timeout: 15_000 })
  await expect(page.locator('scadlet-app .render-error')).toHaveCount(0)
})

test('Geometry Inspect renders the selected subtree immediately and Render returns to the full project', async ({ page }) => {
  await waitForLocalLibrary(page)
  await dropPaletteNode(page, 'cube')
  const cube = page.locator('node-editor .node').filter({ has: page.locator('.node-title', { hasText: 'Cube' }) })
  const cubeHeader = await cube.locator('.node-header').boundingBox()
  if (!cubeHeader) throw new Error('Expected Cube node header')
  await page.mouse.move(cubeHeader.x + 20, cubeHeader.y + cubeHeader.height / 2)
  await page.mouse.down()
  await page.mouse.move(cubeHeader.x - 180, cubeHeader.y + cubeHeader.height / 2, { steps: 6 })
  await page.mouse.up()
  await dropPaletteNode(page, 'sphere')

  await cube.locator('.node-header').dblclick()
  await expect(page.getByRole('button', { name: 'Download .stl', exact: true })).toBeEnabled({ timeout: 15_000 })
  await expect(page.locator('scadlet-app .scad-output')).toContainText('cube(', { timeout: 15_000 })
  await expect(page.locator('scadlet-app .scad-output')).not.toContainText('sphere(')

  await page.getByRole('button', { name: 'Render', exact: true }).click()
  await expect(page.locator('scadlet-app .scad-output')).toContainText('cube(', { timeout: 15_000 })
  await expect(page.locator('scadlet-app .scad-output')).toContainText('sphere(')
})

test('Boolean and Vector3 use editable source titles without redundant body labels', async ({ page }) => {
  await waitForLocalLibrary(page)
  await dropPaletteNode(page, 'boolean')
  await dropPaletteNode(page, 'vector3')
  const sources = page.locator('node-editor .node').filter({ has: page.locator('.node-header input.node-title') })
  const boolean = sources.nth(0)
  const vector = sources.nth(1)
  await expect(boolean.locator('.node-header input.node-title')).toHaveValue('Boolean')
  await boolean.locator('.node-header input.node-title').fill('Centered')
  await boolean.locator('.node-header input.node-title').press('Tab')
  await expect(boolean.locator('.node-controls--primary .node-control-label')).toHaveCount(0)
  await expect(boolean.locator('.node-port--output .node-port-label')).toHaveCount(0)
  await expect(vector.locator('.node-header input.node-title')).toHaveValue('Vector3')
  await vector.locator('.node-header input.node-title').fill('Position')
  await vector.locator('.node-header input.node-title').press('Tab')
  await vector.locator('.node-pin').click()
  await expect(vector.locator('[data-param-key="x"], [data-param-key="y"], [data-param-key="z"]')).toHaveCount(3)
  await expect(vector.getByText('Value', { exact: true })).toHaveCount(0)
  await expect(vector.locator('.node-port--output .node-port-label')).toHaveCount(0)
})

test('focused controls stay expanded and compatible wire hover temporarily reveals targets', async ({ page }) => {
  await waitForLocalLibrary(page)
  await dropPaletteNode(page, 'add')
  const add = page.locator('node-editor .node').filter({ has: page.locator('.node-title', { hasText: 'Add' }) })
  await add.hover()
  const addA = add.locator('[data-param-key="a"] input')
  await expect(addA).toBeVisible({ timeout: 2_000 })
  await addA.focus()
  await page.mouse.move(5, 200)
  await page.waitForTimeout(1_000)
  await expect(addA).toBeVisible()
  await page.locator('scadlet-app header h1').click()
  await expect(addA).toBeHidden({ timeout: 2_000 })

  await dropPaletteNode(page, 'number')
  await dropPaletteNode(page, 'cube')
  const number = page.locator('node-editor .node').filter({ has: page.locator('.node-header input.node-title') })
  const cube = page.locator('node-editor .node').filter({ has: page.locator('.node-title', { hasText: 'Cube' }) })
  await cube.locator('.node-pin').click()
  await cube.getByText('+ Size', { exact: true }).click()
  await cube.getByRole('button', { name: 'Scalar', exact: true }).click()
  await cube.locator('.node-pin').click()
  await expect(cube.locator('[data-param-key="size"]')).toBeHidden()

  const numberHeader = await number.locator('.node-header').boundingBox()
  if (!numberHeader) throw new Error('Expected Number node header')
  await page.mouse.move(numberHeader.x + 20, numberHeader.y + numberHeader.height / 2)
  await page.mouse.down()
  await page.mouse.move(numberHeader.x - 180, numberHeader.y + numberHeader.height / 2, { steps: 8 })
  await page.mouse.up()
  const source = await number.locator('.node-port--output .node-socket').boundingBox()
  const cubeHeader = await cube.locator('.node-header').boundingBox()
  if (!source || !cubeHeader) throw new Error('Expected sockets and compact Cube')
  await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2)
  await page.mouse.down()
  await page.mouse.move(cubeHeader.x + 20, cubeHeader.y + cubeHeader.height / 2, { steps: 8 })
  await expect(cube.locator('[data-param-key="size"]')).toBeVisible()
  await page.mouse.up()
  await page.mouse.move(5, 200)
  await expect(cube.locator('[data-param-key="size"]')).toBeHidden({ timeout: 2_000 })
})

test('connection gestures disclose one compatible compact target repeatedly for drag and click wiring', async ({ page }) => {
  await waitForLocalLibrary(page)

  // Separate two otherwise centrally-created candidates before placing the
  // source above them, so each real pointer move has an unambiguous target.
  const moveNode = async (node: Locator, dx: number, dy: number) => {
    const header = await node.locator('.node-header').boundingBox()
    if (!header) throw new Error('Expected node header')
    await page.mouse.move(header.x + 20, header.y + header.height / 2)
    await page.mouse.down()
    await page.mouse.move(header.x + 20 + dx, header.y + header.height / 2 + dy, { steps: 6 })
    await page.mouse.up()
  }
  const configureScalarCube = async (cube: Locator) => {
    await cube.locator('.node-pin').click()
    await cube.getByText('+ Size', { exact: true }).click()
    await cube.getByRole('button', { name: 'Scalar', exact: true }).click()
    await cube.locator('.node-pin').click()
  }
  await dropPaletteNode(page, 'cube')
  const cubes = page.locator('node-editor .node').filter({ has: page.locator('.node-title', { hasText: 'Cube' }) })
  const cubeAInitial = cubes.nth(0)
  const cubeAId = await cubeAInitial.getAttribute('data-node-id')
  if (!cubeAId) throw new Error('Expected Cube A id')
  const cubeA = page.locator(`node-editor .node[data-node-id="${cubeAId}"]`)
  await configureScalarCube(cubeA)
  await moveNode(cubeA, 140, -90)
  await dropPaletteNode(page, 'cube')
  const cubeBInitial = cubes.nth(1)
  const cubeBId = await cubeBInitial.getAttribute('data-node-id')
  if (!cubeBId) throw new Error('Expected Cube B id')
  const cubeB = page.locator(`node-editor .node[data-node-id="${cubeBId}"]`)
  await configureScalarCube(cubeB)
  await moveNode(cubeB, 160, 110)

  await dropPaletteNode(page, 'number')
  const number = page.locator('node-editor .node').filter({ has: page.locator('.node-header input.node-title') })

  const source = await number.locator('.node-port--output .node-socket').boundingBox()
  const headerA = await cubeA.locator('.node-header').boundingBox()
  const headerB = await cubeB.locator('.node-header').boundingBox()
  if (!source || !headerA || !headerB) throw new Error('Expected Number output and Cube headers')
  const sourceCenter = { x: source.x + source.width / 2, y: source.y + source.height / 2 }

  // Drag mode: move near rather than onto A's tiny socket. The preview
  // acquires the same compatible target that the eventual Rete connection
  // uses, then releases to commit it.
  await page.mouse.move(sourceCenter.x, sourceCenter.y)
  await page.mouse.down()
  await page.mouse.move(headerA.x + 20, headerA.y + headerA.height / 2, { steps: 8 })
  await expect(cubeA.locator('[data-param-key="size"]')).toBeVisible()
  const targetA = await cubeA.locator('[data-param-key="size"] .node-socket').boundingBox()
  if (!targetA) throw new Error('Expected disclosed Cube A Size socket')
  await page.mouse.move(targetA.x + targetA.width / 2 + 18, targetA.y + targetA.height / 2, { steps: 4 })
  await expect(cubeA.locator('[data-param-key="size"] .node-socket')).toHaveClass(/node-socket--snap-target/)
  await page.mouse.up()
  await expect(cubeA.locator('[data-param-key="size"] input')).toBeDisabled()

  // Click mode keeps the same gesture active after release. A second click
  // near B's snapped input completes it without pixel-perfect placement.
  await page.mouse.click(sourceCenter.x, sourceCenter.y)
  await page.mouse.move(headerB.x + 20, headerB.y + headerB.height / 2, { steps: 8 })
  await expect(cubeB.locator('[data-param-key="size"]')).toBeVisible()
  const target = await cubeB.locator('[data-param-key="size"] .node-socket').boundingBox()
  if (!target) throw new Error('Expected disclosed Cube Size socket')
  await page.mouse.move(target.x + target.width / 2 + 18, target.y + target.height / 2, { steps: 3 })
  await expect(cubeB.locator('[data-param-key="size"] .node-socket')).toHaveClass(/node-socket--snap-target/)
  await page.mouse.click(target.x + target.width / 2 + 18, target.y + target.height / 2)
  await expect(cubeB.locator('[data-param-key="size"] input')).toBeDisabled()
  await page.mouse.move(5, 200)
  await expect(cubeB.locator('[data-param-key="size"]')).toBeVisible()

  // A Vector3-only Cube representation is incompatible with this Number
  // wire and must not be exposed as a false target.
  await dropPaletteNode(page, 'cube')
  const cubeInitial = cubes.last()
  const cubeId = await cubeInitial.getAttribute('data-node-id')
  if (!cubeId) throw new Error('Expected Vector Cube id')
  const cube = page.locator(`node-editor .node[data-node-id="${cubeId}"]`)
  await cube.locator('.node-pin').click()
  await cube.getByText('+ Size', { exact: true }).click()
  await cube.getByRole('button', { name: 'Vector', exact: true }).click()
  await cube.locator('.node-pin').click()
  await expect(cube.locator('[data-param-key="sizeVector"]')).toBeHidden()
  const cubeHeader = await cube.locator('.node-header').boundingBox()
  if (!cubeHeader) throw new Error('Expected compact Vector Cube header')
  await page.mouse.click(sourceCenter.x, sourceCenter.y)
  await page.mouse.move(cubeHeader.x + 20, cubeHeader.y + cubeHeader.height / 2, { steps: 8 })
  await expect(cube.locator('[data-param-key="sizeVector"]')).toBeHidden()
  await page.mouse.click(5, 200)
})

test('a selected wire is transient and Delete removes only that connection', async ({ page }) => {
  await waitForLocalLibrary(page)
  await dropPaletteNode(page, 'number')
  await dropPaletteNode(page, 'add')
  const number = page.locator('node-editor .node').filter({ has: page.locator('.node-header input.node-title') })
  const add = page.locator('node-editor .node').filter({ has: page.locator('.node-title', { hasText: 'Add' }) })
  await add.locator('.node-pin').click()
  const numberHeader = await number.locator('.node-header').boundingBox()
  if (!numberHeader) throw new Error('Expected Number header')
  await page.mouse.move(numberHeader.x + 20, numberHeader.y + numberHeader.height / 2)
  await page.mouse.down()
  await page.mouse.move(numberHeader.x - 180, numberHeader.y + numberHeader.height / 2, { steps: 6 })
  await page.mouse.up()
  const source = await number.locator('.node-port--output .node-socket').boundingBox()
  const target = await add.locator('[data-param-key="a"] .node-socket').boundingBox()
  if (!source || !target) throw new Error('Expected Number output and Add A input')
  await page.mouse.click(source.x + source.width / 2, source.y + source.height / 2)
  await page.mouse.click(target.x + target.width / 2, target.y + target.height / 2)
  await expect(add.locator('[data-param-key="a"] input')).toBeDisabled()
  const hit = page.locator('node-editor .connection[data-real-connection="true"] .connection-hit-path')
  await hit.dispatchEvent('pointerdown', { button: 0 })
  await expect(page.locator('node-editor .connection--selected')).toHaveCount(1)
  await page.keyboard.press('Delete')
  await expect(hit).toHaveCount(0)
  await expect(add.locator('[data-param-key="a"] input')).toBeEnabled()
})

test('connected compact rows preserve canonical order when expanded', async ({ page }) => {
  await waitForLocalLibrary(page)

  const moveNode = async (node: Locator, dx: number, dy: number) => {
    const header = await node.locator('.node-header').boundingBox()
    if (!header) throw new Error('Expected node header')
    await page.mouse.move(header.x + 20, header.y + header.height / 2)
    await page.mouse.down()
    await page.mouse.move(header.x + 20 + dx, header.y + header.height / 2, { steps: 6 })
    await page.mouse.up()
  }
  const visibleRowKeys = (node: Locator) => node.locator('.node-param-row').evaluateAll((rows) =>
    rows.filter((row) => !row.hidden).map((row) => row.getAttribute('data-param-key')),
  )
  const numberSources = page.locator('node-editor .node').filter({ has: page.locator('.node-header input[aria-label="Number Name"]') })
  let numberIndex = 0
  const connectNumber = async (node: Locator, key: string, throughDisclosure = false) => {
    if (!throughDisclosure) await node.locator('.node-pin').click()
    await dropPaletteNode(page, 'number')
    const number = numberSources.nth(numberIndex++)
    const source = await number.locator('.node-port--output .node-socket').boundingBox()
    const header = await node.locator('.node-header').boundingBox()
    if (!source || !header) throw new Error('Expected Number output and target header')
    await page.mouse.click(source.x + source.width / 2, source.y + source.height / 2)
    if (throughDisclosure) {
      await page.mouse.move(header.x + 20, header.y + header.height / 2, { steps: 8 })
      await expect(node.locator(`[data-param-key="${key}"]`)).toBeVisible()
    } else {
      await page.waitForTimeout(50)
    }
    const target = await node.locator(`[data-param-key="${key}"] .node-socket`).boundingBox()
    if (!target) throw new Error(`Expected disclosed ${key} socket`)
    await page.mouse.click(target.x + target.width / 2, target.y + target.height / 2)
    await expect(node.locator(`[data-param-key="${key}"] input`)).toBeDisabled()
    if (!throughDisclosure) await node.locator('.node-pin').click()
    await page.mouse.move(5, 200)
  }
  const hoverAndExpectOrder = async (node: Locator, expected: string[]) => {
    await node.locator('.node-header').hover()
    await expect.poll(() => visibleRowKeys(node), { timeout: 2_000 }).toEqual(expected)
  }

  await dropPaletteNode(page, 'translate')
  const translate = page.locator('node-editor .node').filter({ has: page.locator('.node-title', { hasText: 'Translate' }) })
  await moveNode(translate, 190, -120)
  await connectNumber(translate, 'z', true)
  await expect.poll(() => visibleRowKeys(translate), { timeout: 2_000 }).toEqual(['z'])
  await hoverAndExpectOrder(translate, ['x', 'y', 'z'])
  await connectNumber(translate, 'x')
  await expect.poll(() => visibleRowKeys(translate), { timeout: 2_000 }).toEqual(['x', 'z'])
  await hoverAndExpectOrder(translate, ['x', 'y', 'z'])
  await translate.locator('[data-param-key="y"] input').focus()
  await page.mouse.move(5, 200)
  await page.waitForTimeout(1_000)
  await expect.poll(() => visibleRowKeys(translate)).toEqual(['x', 'y', 'z'])

  // Phase 1 disclosure combines with the connected compact row, but still
  // uses Translate's canonical X/Y/Z order rather than connected-first.
  await dropPaletteNode(page, 'number')
  const disclosureSource = numberSources.nth(numberIndex++)
  const disclosureSocket = await disclosureSource.locator('.node-port--output .node-socket').boundingBox()
  const translateHeader = await translate.locator('.node-header').boundingBox()
  if (!disclosureSocket || !translateHeader) throw new Error('Expected disclosure source and Translate header')
  await page.mouse.move(disclosureSocket.x + disclosureSocket.width / 2, disclosureSocket.y + disclosureSocket.height / 2)
  await page.mouse.down()
  await page.mouse.move(translateHeader.x + 20, translateHeader.y + translateHeader.height / 2, { steps: 8 })
  await expect.poll(() => visibleRowKeys(translate)).toEqual(['x', 'y', 'z'])
  await page.mouse.up()
  await page.mouse.move(5, 200)
  await expect.poll(() => visibleRowKeys(translate), { timeout: 2_000 }).toEqual(['x', 'z'])

  await dropPaletteNode(page, 'add')
  const add = page.locator('node-editor .node').filter({ has: page.locator('.node-title', { hasText: 'Add' }) })
  await moveNode(add, 190, 0)
  await connectNumber(add, 'b')
  await expect.poll(() => visibleRowKeys(add), { timeout: 2_000 }).toEqual(['b'])
  await hoverAndExpectOrder(add, ['a', 'b'])
  await connectNumber(add, 'a')
  await expect.poll(() => visibleRowKeys(add), { timeout: 2_000 }).toEqual(['a', 'b'])
  await hoverAndExpectOrder(add, ['a', 'b'])
})

test('Vector3 connected rows retain canonical order', async ({ page }) => {
  await waitForLocalLibrary(page)

  const moveNode = async (node: Locator, dx: number, dy: number) => {
    const header = await node.locator('.node-header').boundingBox()
    if (!header) throw new Error('Expected node header')
    await page.mouse.move(header.x + 20, header.y + header.height / 2)
    await page.mouse.down()
    await page.mouse.move(header.x + 20 + dx, header.y + header.height / 2, { steps: 6 })
    await page.mouse.up()
  }
  const visibleRowKeys = (node: Locator) => node.locator('.node-param-row').evaluateAll((rows) =>
    rows.filter((row) => !row.hidden).map((row) => row.getAttribute('data-param-key')),
  )
  const numberSources = page.locator('node-editor .node').filter({ has: page.locator('.node-header input[aria-label="Number Name"]') })
  let numberIndex = 0
  const connectNumber = async (node: Locator, key: string) => {
    if (numberIndex === 0) await node.locator('.node-pin').click()
    else await node.locator('.node-pin').click({ force: true })
    await dropPaletteNode(page, 'number')
    const number = numberSources.nth(numberIndex++)
    const source = await number.locator('.node-port--output .node-socket').boundingBox()
    const target = await node.locator(`[data-param-key="${key}"] .node-socket`).boundingBox()
    if (!source || !target) throw new Error(`Expected Number output and ${key} socket`)
    await page.mouse.click(source.x + source.width / 2, source.y + source.height / 2)
    await page.waitForTimeout(50)
    await page.mouse.click(target.x + target.width / 2, target.y + target.height / 2)
    await expect(node.locator(`[data-param-key="${key}"] input`)).toBeDisabled()
    await moveNode(number, -180, -100)
    await node.locator('.node-pin').click({ force: true })
    await page.mouse.move(5, 200)
  }
  const hoverAndExpectOrder = async (node: Locator, expected: string[]) => {
    await node.locator('.node-header').hover({ force: true })
    await expect.poll(() => visibleRowKeys(node), { timeout: 2_000 }).toEqual(expected)
  }

  await dropPaletteNode(page, 'vector3')
  const vector = page.locator('node-editor .node').filter({ has: page.locator('.node-header input.node-title') }).filter({ has: page.locator('[data-param-key="x"]') })
  await moveNode(vector, 190, 110)
  await connectNumber(vector, 'y')
  await expect.poll(() => visibleRowKeys(vector), { timeout: 2_000 }).toEqual(['y'])
  await hoverAndExpectOrder(vector, ['x', 'y', 'z'])
  await connectNumber(vector, 'z')
  await expect.poll(() => visibleRowKeys(vector), { timeout: 2_000 }).toEqual(['y', 'z'])
  await hoverAndExpectOrder(vector, ['x', 'y', 'z'])
  await connectNumber(vector, 'x')
  await expect.poll(() => visibleRowKeys(vector), { timeout: 2_000 }).toEqual(['x', 'y', 'z'])
  await hoverAndExpectOrder(vector, ['x', 'y', 'z'])
})

test('Cube XYZ connected rows retain canonical order', async ({ page }) => {
  await waitForLocalLibrary(page)

  const moveNode = async (node: Locator, dx: number, dy: number) => {
    const header = await node.locator('.node-header').boundingBox()
    if (!header) throw new Error('Expected node header')
    await page.mouse.move(header.x + 20, header.y + header.height / 2)
    await page.mouse.down()
    await page.mouse.move(header.x + 20 + dx, header.y + header.height / 2, { steps: 6 })
    await page.mouse.up()
  }
  const visibleRowKeys = (node: Locator) => node.locator('.node-param-row').evaluateAll((rows) =>
    rows.filter((row) => !row.hidden).map((row) => row.getAttribute('data-param-key')),
  )

  await dropPaletteNode(page, 'cube')
  const cube = page.locator('node-editor .node').filter({ has: page.locator('.node-title', { hasText: 'Cube' }) })
  await cube.locator('.node-pin').click()
  await cube.getByText('+ Size', { exact: true }).click()
  await cube.getByRole('button', { name: 'XYZ', exact: true }).click()
  await cube.locator('.node-pin').click()
  await moveNode(cube, 190, 210)
  await cube.locator('.node-pin').click()
  await dropPaletteNode(page, 'number')
  const number = page.locator('node-editor .node').filter({ has: page.locator('.node-header input[aria-label="Number Name"]') })
  const source = await number.locator('.node-port--output .node-socket').boundingBox()
  const target = await cube.locator('[data-param-key="sizeZ"] .node-socket').boundingBox()
  if (!source || !target) throw new Error('Expected Number output and Cube Z socket')
  await page.mouse.click(source.x + source.width / 2, source.y + source.height / 2)
  await page.waitForTimeout(50)
  await page.mouse.click(target.x + target.width / 2, target.y + target.height / 2)
  await expect(cube.locator('[data-param-key="sizeZ"] input')).toBeDisabled()
  await cube.locator('.node-pin').click()
  await page.mouse.move(5, 200)
  await expect.poll(() => visibleRowKeys(cube), { timeout: 2_000 }).toEqual(['sizeZ'])
  await cube.locator('.node-header').hover()
  await expect.poll(() => visibleRowKeys(cube), { timeout: 2_000 }).toEqual(['sizeX', 'sizeY', 'sizeZ'])
  await expect(cube.locator('.node-param-rows').locator('.node-param-header')).toHaveCount(1)
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
  await dropPaletteNode(second, 'sphere')
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

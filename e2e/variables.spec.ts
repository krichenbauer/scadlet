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

async function renameValue(node: Locator, name: string): Promise<void> {
  await node.locator('.node-more-summary').click()
  await node.getByRole('menuitem', { name: 'Rename', exact: true }).click()
  await node.locator('input.node-title').fill(name)
  await node.locator('input.node-title').press('Enter')
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

async function fileAction(page: Page, name: string): Promise<Locator> {
  const trigger = page.locator('scadlet-app header').getByRole('button', { name: /^File\b/ })
  if (await trigger.getAttribute('aria-expanded') !== 'true') await trigger.click()
  return page.getByRole('menuitem', { name, exact: true })
}

function variableProject() {
  const cube = { sizeRepresentation: 'scalar', size: 1, sizeScalar: 1, sizeVector: { x: 1, y: 1, z: 1 } }
  return {
    format: 'scadlet', version: 8, metadata: { name: 'Variables' },
    graph: {
      nodes: [
        { id: 'spacing-node', type: 'number', position: { x: 60, y: 80 }, parameters: { value: 12, name: 'spacing', bindingId: 'spacing-binding' } },
        { id: 'legacy-node', type: 'number', position: { x: 60, y: 300 }, parameters: { value: 4, name: 'Legacy label' } },
        { id: 'spacing-reference', type: 'variable-reference', position: { x: 320, y: 80 }, parameters: { bindingId: 'spacing-binding' } },
        { id: 'main-cube', type: 'cube', position: { x: 540, y: 80 }, parameters: cube },
      ],
      connections: [{ id: 'spacing-size', source: 'spacing-reference', sourceOutput: 'value', target: 'main-cube', targetInput: 'size' }],
    },
    definitions: [
      {
        id: 'module', kind: 'module', name: 'panel', interface: { inputs: 'module-inputs', output: 'module-output' },
        parameters: [{ id: 'module-width', name: 'width', type: 'number', default: 5 }], geometryInputs: [],
        graph: {
          nodes: [
            { id: 'module-inputs', type: 'module-inputs', position: { x: 80, y: 560 }, parameters: {} },
            { id: 'module-reference', type: 'variable-reference', position: { x: 330, y: 560 }, parameters: { bindingId: 'module-width' } },
            { id: 'module-cube', type: 'cube', position: { x: 520, y: 560 }, parameters: cube },
            { id: 'module-output', type: 'module-output', position: { x: 760, y: 560 }, parameters: {} },
          ],
          connections: [
            { id: 'module-size', source: 'module-reference', sourceOutput: 'value', target: 'module-cube', targetInput: 'size' },
            { id: 'module-body', source: 'module-cube', sourceOutput: 'geometry', target: 'module-output', targetInput: 'geometry' },
          ],
        },
      },
      {
        id: 'function', kind: 'function', name: 'identity', interface: { inputs: 'function-inputs', output: 'function-output' },
        parameters: [{ id: 'function-x', name: 'x', type: 'number', default: 2 }], resultType: 'number',
        graph: {
          nodes: [
            { id: 'function-inputs', type: 'function-inputs', position: { x: 1040, y: 560 }, parameters: {} },
            { id: 'function-reference', type: 'variable-reference', position: { x: 1270, y: 560 }, parameters: { bindingId: 'function-x' } },
            { id: 'function-output', type: 'function-output', position: { x: 1470, y: 560 }, parameters: {} },
          ],
          connections: [{ id: 'function-result', source: 'function-reference', sourceOutput: 'value', target: 'function-output', targetInput: 'result' }],
        },
      },
    ],
    editor: { viewport: { x: 0, y: 0, zoom: 0.75 } }, viewer: { camera: CAMERA },
  }
}

function connectedValueProject() {
  const cube = { sizeRepresentation: 'scalar', size: 1, sizeScalar: 1, sizeVector: { x: 1, y: 1, z: 1 }, center: false }
  return {
    format: 'scadlet', version: 8, metadata: { name: 'Connected Values' },
    graph: {
      nodes: [
        { id: 'divide', type: 'arithmetic', position: { x: 40, y: 40 }, parameters: { operation: 'division', a: 12, b: 3 } },
        { id: 'spacing', type: 'number', position: { x: 260, y: 40 }, parameters: { value: 99, name: 'spacing', bindingId: 'spacing-binding' } },
        { id: 'spacing-ref', type: 'variable-reference', position: { x: 500, y: 40 }, parameters: { bindingId: 'spacing-binding' } },
        { id: 'compare', type: 'compare', position: { x: 40, y: 260 }, parameters: { operator: '>', a: 5, b: 2 } },
        { id: 'centered', type: 'boolean', position: { x: 260, y: 260 }, parameters: { value: false, name: 'centered', bindingId: 'centered-binding' } },
        { id: 'centered-ref', type: 'variable-reference', position: { x: 500, y: 260 }, parameters: { bindingId: 'centered-binding' } },
        { id: 'vector-expression', type: 'vector3', position: { x: 40, y: 480 }, parameters: { x: 4, y: 5, z: 6, name: 'Vector3' } },
        { id: 'offset', type: 'vector3', position: { x: 300, y: 480 }, parameters: { x: 1, y: 2, z: 3, name: 'offset', bindingId: 'offset-binding' } },
        { id: 'offset-ref', type: 'variable-reference', position: { x: 560, y: 480 }, parameters: { bindingId: 'offset-binding' } },
        { id: 'cube', type: 'cube', position: { x: 760, y: 100 }, parameters: cube },
        { id: 'pass-through', type: 'number', position: { x: 760, y: 360 }, parameters: { value: 8, name: 'Legacy label' } },
        { id: 'direct-cube', type: 'cube', position: { x: 990, y: 360 }, parameters: cube },
        { id: 'translate', type: 'translate', position: { x: 1220, y: 360 }, parameters: { representation: 'vector', x: 0, y: 0, z: 0 } },
      ],
      connections: [
        { id: 'divide-spacing', source: 'divide', sourceOutput: 'value', target: 'spacing', targetInput: 'value' },
        { id: 'spacing-cube', source: 'spacing-ref', sourceOutput: 'value', target: 'cube', targetInput: 'size' },
        { id: 'compare-centered', source: 'compare', sourceOutput: 'value', target: 'centered', targetInput: 'value' },
        { id: 'centered-cube', source: 'centered-ref', sourceOutput: 'value', target: 'cube', targetInput: 'center' },
        { id: 'vector-offset', source: 'vector-expression', sourceOutput: 'value', target: 'offset', targetInput: 'value' },
        { id: 'offset-translate', source: 'offset-ref', sourceOutput: 'value', target: 'translate', targetInput: 'vector' },
        { id: 'spacing-pass', source: 'spacing', sourceOutput: 'value', target: 'pass-through', targetInput: 'value' },
        { id: 'pass-cube', source: 'pass-through', sourceOutput: 'value', target: 'direct-cube', targetInput: 'size' },
        { id: 'direct-geometry', source: 'direct-cube', sourceOutput: 'geometry', target: 'translate', targetInput: 'geometry' },
      ],
    },
    definitions: [], editor: { viewport: { x: 0, y: 0, zoom: 0.62 } }, viewer: { camera: CAMERA },
  }
}

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    Object.defineProperty(window, 'showOpenFilePicker', { value: undefined, configurable: true })
    Object.defineProperty(window, 'showSaveFilePicker', { value: undefined, configurable: true })
  })
})

test('reference controls support click-place, Escape, scope cancellation, drag creation, and definition cleanup', async ({ page }) => {
  test.setTimeout(60_000)
  await ready(page)
  await page.getByRole('switch', { name: 'Live render', exact: true }).click()
  const editor = page.locator('node-editor')
  const bounds = await editor.boundingBox()
  if (!bounds) throw new Error('Expected editor bounds')
  await dropPaletteNode(page, 'number', { x: bounds.x + 140, y: bounds.y + 160 })
  const number = editor.locator('.node[data-node-type="number"]').first()
  const createReference = number.getByRole('button', { name: 'Create variable reference', exact: true })
  await expect(createReference).toBeDisabled()
  await expect(createReference).toHaveAttribute('title', /Name this Value/)
  await expect(createReference).toHaveText('')

  await renameValue(number, 'spacing')
  await expect(createReference).toBeEnabled()
  await expect(createReference).toHaveAttribute('title', 'Create variable reference')

  await dropPaletteNode(page, 'number', { x: bounds.x + 380, y: bounds.y + 280 })
  const duplicate = editor.locator('.node[data-node-type="number"]').last()
  await renameValue(duplicate, 'spacing')
  await expect(editor.locator('.editor-feedback')).toContainText('already exists in this scope')
  await expect(duplicate.locator('.node-title')).toHaveText('Number')
  await expect(duplicate.getByRole('button', { name: 'Create variable reference', exact: true })).toBeDisabled()
  await duplicate.locator('.node-more-summary').click()
  await duplicate.getByRole('menuitem', { name: 'Delete', exact: true }).click()

  await createReference.click()
  await expect(editor.locator('.variable-reference-placement-ghost')).toHaveText('spacing')
  await page.keyboard.press('Escape')
  await expect(editor.locator('.variable-reference-placement-ghost')).toHaveCount(0)
  await expect(editor.locator('.node[data-node-type="variable-reference"]')).toHaveCount(0)

  await createReference.click()
  await page.mouse.click(bounds.x + bounds.width / 2 - 120, bounds.y + 110)
  const references = editor.locator('.node[data-node-type="variable-reference"]')
  await expect(references).toHaveCount(1)
  await expect(references.first().locator('.node-title')).toHaveText('spacing')
  await expect(references.first().locator('.node-control, .node-port--input')).toHaveCount(0)
  await expect(references.first().locator('.node-port--output .node-socket')).toHaveAttribute('aria-label', 'Variable value output')
  expect((await references.first().boundingBox())?.width).toBeLessThanOrEqual(180)

  // Selecting another semantic scope cancels placement. The following blank
  // canvas click must stay a normal click and cannot create a delayed node.
  const moduleId = await editor.evaluate(async (element) => {
    const instance = (element as unknown as { getEditorInstance(): { createModule(name: string): Promise<{ id: string }> } }).getEditorInstance()
    return (await instance.createModule('holder')).id
  })
  await createReference.click()
  await editor.locator(`.definition-frame[data-definition-id="${moduleId}"] .definition-frame-title`).click()
  await expect(editor.locator('.variable-reference-placement-ghost')).toHaveCount(0)
  await page.mouse.click(bounds.x + bounds.width - 110, bounds.y + 210)
  await expect(references).toHaveCount(1)

  // Native drag data comes from the icon itself. Dropping creates only a
  // node: no Rete connection/wire is manufactured by this gesture.
  await editor.evaluate((element, point) => {
    const root = element.shadowRoot
    const button = root?.querySelector<HTMLButtonElement>('.node[data-node-type="number"] .node-create-variable-reference')
    const canvas = root?.querySelector('#canvas')
    if (!button || !canvas) throw new Error('Expected reference control and canvas')
    const dataTransfer = new DataTransfer()
    button.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer }))
    canvas.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, clientX: point.x, clientY: point.y, dataTransfer }))
    canvas.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, clientX: point.x, clientY: point.y, dataTransfer }))
  }, { x: bounds.x + 24, y: bounds.y + 24 })
  await expect(references).toHaveCount(2)
  await expect(editor.locator('.connection[data-real-connection="true"]')).toHaveCount(0)

  // An individual reference is an ordinary deletable node and needs no
  // special confirmation.
  await references.first().locator('.node-more-summary').click()
  await references.first().getByRole('menuitem', { name: 'Delete', exact: true }).click()
  await expect(references).toHaveCount(1)

  page.once('dialog', async (dialog) => {
    expect(dialog.message()).toContain('1 variable reference(s)')
    await dialog.dismiss()
  })
  await number.locator('.node-more-summary').click()
  await number.getByRole('menuitem', { name: 'Delete', exact: true }).click()
  await expect(number).toHaveCount(1)
  await expect(references).toHaveCount(1)

  page.once('dialog', async (dialog) => {
    expect(dialog.message()).toContain('1 variable reference(s)')
    await dialog.accept()
  })
  await number.locator('.node-more-summary').click()
  await number.getByRole('menuitem', { name: 'Delete', exact: true }).click()
  await expect(number).toHaveCount(0)
  await expect(references).toHaveCount(0)
})

test('restored scoped references expose parameter controls, render and export identifiers, and propagate renames', async ({ page }) => {
  test.setTimeout(60_000)
  await seedActiveProject(page, variableProject(), 'variables')
  await page.getByRole('switch', { name: 'Live render', exact: true }).click()
  const editor = page.locator('node-editor')
  const enabledControl = (nodeId: string) => editor.locator(`.node[data-node-id="${nodeId}"]`).getByRole('button', { name: 'Create variable reference', exact: true })
  await expect(enabledControl('spacing-node')).toBeEnabled()
  await expect(enabledControl('legacy-node')).toBeDisabled()
  await expect(enabledControl('module-inputs')).toBeEnabled()
  await expect(enabledControl('function-inputs')).toBeEnabled()
  await expect(enabledControl('module-inputs')).toHaveAttribute('title', 'Create variable reference')

  const evaluate = () => editor.evaluate(async (element) => {
    const instance = (element as unknown as { getEditorInstance(): { evaluate(): Promise<string> } }).getEditorInstance()
    return instance.evaluate()
  })
  const restoredSource = await evaluate()
  expect(restoredSource).toContain('function identity(x = 2) = x;')
  expect(restoredSource).toContain('module panel(width = 5)')
  expect(restoredSource).toContain('cube(width);')
  expect(restoredSource).toContain('spacing = 12;')
  expect(restoredSource).toContain('cube(spacing);')

  const number = editor.locator('.node[data-node-id="spacing-node"]')
  await renameValue(number, 'distance')
  await expect(editor.locator('.node[data-node-id="spacing-reference"] .node-title')).toHaveText('distance')
  expect(await evaluate()).toContain('distance = 12;')
  await page.getByRole('button', { name: 'Render', exact: true }).click()
  const source = page.locator('scadlet-app .scad-output')
  await expect(source).toContainText('distance = 12;', { timeout: 15_000 })
  await expect(source).toContainText('cube(distance);')

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    (await fileAction(page, 'Download .scad')).click(),
  ])
  const path = await download.path()
  if (!path) throw new Error('Expected downloaded SCAD path')
  expect(readFileSync(path, 'utf8').trim()).toBe(((await source.textContent()) ?? '').trim())
  const stop = page.getByRole('button', { name: 'Stop', exact: true })
  if (await stop.isVisible()) await stop.click()

  await page.waitForTimeout(1_000)
  await page.reload()
  await expect(editor.locator('.node[data-node-id="spacing-reference"] .node-title')).toHaveText('distance')
  await expect(editor.locator('.node[data-node-id="spacing-reference"]')).toHaveAttribute('data-node-type', 'variable-reference')
  await expect(page.locator('scadlet-app .render-error')).toHaveCount(0)

  page.once('dialog', async (dialog) => {
    expect(dialog.message()).toContain('1 variable reference(s)')
    await dialog.accept()
  })
  await editor.locator('.node[data-node-id="module-inputs"]').getByRole('button', { name: 'Remove width', exact: true }).click()
  await expect(editor.locator('.node[data-node-id="module-reference"]')).toHaveCount(0)
  await expect(editor.locator('.node[data-node-id="module-inputs"]').getByRole('button', { name: 'Create variable reference', exact: true })).toHaveCount(0)
})

test('typed Value inputs override preserved fallbacks, survive restore, reject invalid wires, and drive render/export', async ({ page }) => {
  test.setTimeout(60_000)
  await seedActiveProject(page, connectedValueProject(), 'connected-values')
  await page.getByRole('switch', { name: 'Live render', exact: true }).click()
  const editor = page.locator('node-editor')
  const valueRow = (id: string) => editor.locator(`.node[data-node-id="${id}"] .node-param-row[data-param-key="value"]`)

  for (const id of ['spacing', 'centered', 'offset', 'pass-through']) {
    await expect(valueRow(id)).toHaveAttribute('data-connected', 'true')
    await expect(valueRow(id)).toHaveAttribute('data-value-source', 'connected')
    await expect(valueRow(id)).toHaveAttribute('aria-label', 'Value: Connected value')
  }
  await expect(valueRow('spacing').locator('input')).toBeDisabled()
  await expect(valueRow('spacing').locator('input')).toHaveAttribute('title', 'Connected value overrides the saved fallback literal.')
  await expect(editor.locator('.node[data-node-id="spacing"] .node-collapse')).toHaveCount(0)
  await expect(editor.locator('.node[data-node-id="offset"] .node-param-row[data-param-key="x"]')).toHaveAttribute('data-overridden', 'true')
  await expect(editor.locator('.node[data-node-id="offset"] .node-param-row[data-param-key="x"] input')).toBeDisabled()

  const evaluate = () => editor.evaluate(async (element) => {
    const instance = (element as unknown as { getEditorInstance(): { evaluate(): Promise<string> } }).getEditorInstance()
    return instance.evaluate()
  })
  const connectedSource = await evaluate()
  expect(connectedSource).toContain('spacing = (12 / 3);')
  expect(connectedSource).toContain('centered = (5 > 2);')
  expect(connectedSource).toContain('offset = [4, 5, 6];')
  expect(connectedSource).toContain('cube(spacing, center=centered);')
  expect(connectedSource).toContain('cube((12 / 3));')
  expect(connectedSource).toContain('translate(offset)')

  const connectionCount = editor.locator('.connection[data-real-connection="true"]')
  await expect(connectionCount).toHaveCount(9)
  const spacingInput = valueRow('spacing').locator('.node-socket')
  await connect(page, editor.locator('.node[data-node-id="centered-ref"] .node-port--output .node-socket'), spacingInput)
  await connect(page, editor.locator('.node[data-node-id="cube"] .node-port--output .node-socket'), spacingInput)
  await expect(connectionCount).toHaveCount(9)

  await page.getByRole('button', { name: 'Render', exact: true }).click()
  const source = page.locator('scadlet-app .scad-output')
  await expect(source).toContainText('spacing = (12 / 3);', { timeout: 15_000 })
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    (await fileAction(page, 'Download .scad')).click(),
  ])
  const path = await download.path()
  if (!path) throw new Error('Expected downloaded SCAD path')
  expect(readFileSync(path, 'utf8').trim()).toBe(((await source.textContent()) ?? '').trim())

  const incoming = editor.locator('.connection[data-connection-id="divide-spacing"] .connection-hit-path')
  await incoming.dispatchEvent('pointerdown', { button: 0 })
  await page.keyboard.press('Delete')
  await expect(incoming).toHaveCount(0)
  await expect(valueRow('spacing')).toHaveAttribute('data-value-source', 'fallback')
  await expect(valueRow('spacing')).toHaveAttribute('aria-label', 'Value: Fallback value')
  await expect(valueRow('spacing').locator('input')).toBeEnabled()
  await expect(valueRow('spacing').locator('input')).toHaveValue('99')
  expect(await evaluate()).toContain('spacing = 99;')

  await page.waitForTimeout(1_000)
  await page.reload()
  await expect(valueRow('spacing')).toHaveAttribute('data-value-source', 'fallback')
  await expect(valueRow('spacing').locator('input')).toHaveValue('99')
  expect(await evaluate()).toContain('spacing = 99;')
})

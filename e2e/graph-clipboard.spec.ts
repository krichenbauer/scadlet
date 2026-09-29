import { expect, test, type Locator, type Page } from './fixtures'
import { waitForBoundingBox, waitForUiCommit } from './support'

async function ready(page: Page): Promise<{ editor: Locator; bounds: { x: number; y: number; width: number; height: number } }> {
  await page.goto('/')
  await expect(page.getByRole('textbox', { name: 'Project name' })).toBeEnabled()
  await page.getByRole('switch', { name: 'Live render', exact: true }).click()
  const editor = page.locator('node-editor')
  return { editor, bounds: await waitForBoundingBox(editor) }
}

async function dropNode(page: Page, type: string, point: { x: number; y: number }): Promise<void> {
  await page.locator('node-editor').evaluate((element, input) => {
    const canvas = element.shadowRoot?.querySelector('#canvas')
    if (!canvas) throw new Error('Expected graph canvas')
    const dataTransfer = new DataTransfer()
    dataTransfer.setData('application/x-scadlet-node-type', input.type)
    canvas.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, composed: true, clientX: input.x, clientY: input.y, dataTransfer }))
    canvas.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, composed: true, clientX: input.x, clientY: input.y, dataTransfer }))
  }, { type, ...point })
}

async function connect(page: Page, source: Locator, target: Locator): Promise<void> {
  const start = await waitForBoundingBox(source)
  const end = await waitForBoundingBox(target)
  await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2)
  await page.mouse.down()
  await page.mouse.move(end.x + end.width / 2, end.y + end.height / 2, { steps: 8 })
  await page.mouse.up()
}

async function clickNode(node: Locator, modifiers: ('Shift' | 'Control' | 'Meta')[] = []): Promise<void> {
  await node.locator('.node-header').click({ position: { x: 20, y: 12 }, modifiers })
}

async function graphShortcut(page: Page, key: 'C' | 'X' | 'V' | 'D'): Promise<void> {
  const apple = await page.evaluate(() => /Mac|iPhone|iPad|iPod/u.test(navigator.platform))
  await page.keyboard.press(`${apple ? 'Meta' : 'Control'}+${key}`)
}

test('keyboard copy, paste placement, repeated paste, duplicate cancellation, and native editing stay graph-native', async ({ page }) => {
  const { editor, bounds } = await ready(page)
  await dropNode(page, 'cube', { x: bounds.x + 100, y: bounds.y + 100 })
  await dropNode(page, 'translate', { x: bounds.x + 390, y: bounds.y + 100 })
  const cube = editor.locator('.node[data-node-type="cube"]').first()
  const translate = editor.locator('.node[data-node-type="translate"]').first()
  await connect(page, cube.locator('.node-port--output .node-socket'), translate.locator('.node-inputs .node-socket'))
  await clickNode(cube)
  await clickNode(translate, ['Shift'])
  await editor.evaluate((element) => {
    const canvas = element.shadowRoot!.querySelector<HTMLElement>('#canvas')!
    canvas.dataset.clipboardSemanticChanges = '0'
    const instance = (element as unknown as { getEditorInstance(): { onSemanticChange(callback: () => void): () => void } }).getEditorInstance()
    instance.onSemanticChange(() => {
      canvas.dataset.clipboardSemanticChanges = String(Number(canvas.dataset.clipboardSemanticChanges ?? '0') + 1)
    })
  })

  await graphShortcut(page, 'C')
  await expect(editor.locator('.node')).toHaveCount(2)
  await graphShortcut(page, 'V')
  const preview = editor.locator('.graph-placement-preview')
  await expect(preview).toBeVisible()
  await expect(preview.locator('.graph-placement-preview-node')).toHaveCount(2)
  await expect(preview.locator('.graph-placement-preview-wires path')).toHaveCount(1)
  await expect(editor.locator('.node')).toHaveCount(2)
  await expect(editor.locator('#canvas')).toHaveAttribute('data-clipboard-semantic-changes', '0')

  await page.mouse.move(bounds.x + bounds.width - 240, bounds.y + bounds.height - 180)
  await page.mouse.click(bounds.x + bounds.width - 240, bounds.y + bounds.height - 180)
  await expect(preview).toHaveCount(0)
  await expect(editor.locator('.node')).toHaveCount(4)
  await expect(editor.locator('.connection[data-real-connection="true"]')).toHaveCount(2)
  await expect(editor.locator('.node.node--selected')).toHaveCount(2)
  await expect(editor.locator('#canvas')).toHaveAttribute('data-clipboard-semantic-changes', '1')
  expect(await editor.evaluate(async (element) => {
    const source = await (element as unknown as { getEditorInstance(): { evaluate(): Promise<string> } }).getEditorInstance().evaluate()
    return source.match(/translate\(/gu)?.length ?? 0
  })).toBe(2)

  const firstIds = await editor.locator('.node').evaluateAll((nodes) => nodes.map((node) => (node as HTMLElement).dataset.nodeId))
  expect(new Set(firstIds).size).toBe(4)
  await graphShortcut(page, 'V')
  await page.mouse.click(bounds.x + bounds.width - 150, bounds.y + bounds.height - 80)
  await expect(editor.locator('.node')).toHaveCount(6)
  await expect(editor.locator('.connection[data-real-connection="true"]')).toHaveCount(3)
  await expect(editor.locator('#canvas')).toHaveAttribute('data-clipboard-semantic-changes', '2')

  const oneCopy = editor.locator('.node[data-node-type="cube"]').first()
  await clickNode(oneCopy)
  await graphShortcut(page, 'D')
  await expect(preview.locator('.graph-placement-preview-node')).toHaveCount(1)
  await page.keyboard.press('Escape')
  await expect(preview).toHaveCount(0)
  await expect(editor.locator('.node')).toHaveCount(6)

  // Duplicate does not replace the two-node clipboard copied above.
  await graphShortcut(page, 'V')
  await expect(preview.locator('.graph-placement-preview-node')).toHaveCount(2)
  await page.keyboard.press('Escape')

  const projectName = page.getByRole('textbox', { name: 'Project name' })
  await projectName.fill('Native clipboard text')
  await projectName.selectText()
  await graphShortcut(page, 'C')
  await graphShortcut(page, 'D')
  await graphShortcut(page, 'V')
  await expect(preview).toHaveCount(0)
  await expect(editor.locator('.node')).toHaveCount(6)
})

test('viewport fallback is centred and every native editable surface keeps its shortcuts', async ({ page }) => {
  const { editor } = await ready(page)
  await editor.evaluate(async (element) => {
    const instance = (element as unknown as { getEditorInstance(): {
      addNodeAt(type: string, position: { x: number; y: number }): Promise<void>
      editor: { getNodes(): { selected?: boolean; id: string }[] }
      area: { update(kind: 'node', id: string): Promise<void> }
    } }).getEditorInstance()
    const rect = element.getBoundingClientRect()
    await instance.addNodeAt('cube', { x: rect.left + 80, y: rect.top + 80 })
    const node = instance.editor.getNodes()[0]!
    node.selected = true
    await instance.area.update('node', node.id)
    element.shadowRoot!.querySelector<HTMLElement>('#canvas')!.focus()
  })

  await graphShortcut(page, 'C')
  await graphShortcut(page, 'V')
  const canvasBox = await waitForBoundingBox(editor.locator('#canvas'))
  const previewBox = await waitForBoundingBox(editor.locator('.graph-placement-preview'))
  expect(Math.abs((previewBox.x + previewBox.width / 2) - (canvasBox.x + canvasBox.width / 2))).toBeLessThan(3)
  expect(Math.abs((previewBox.y + previewBox.height / 2) - (canvasBox.y + canvasBox.height / 2))).toBeLessThan(3)
  await page.keyboard.press('Escape')

  const defaultPrevented = await editor.evaluate((element) => {
    const canvas = element.shadowRoot!.querySelector<HTMLElement>('#canvas')!
    const make = <T extends HTMLElement>(tag: string, configure: (control: T) => void): T => {
      const control = document.createElement(tag) as T
      configure(control)
      control.style.position = 'fixed'
      control.style.left = '1px'
      control.style.top = '1px'
      canvas.appendChild(control)
      return control
    }
    const text = make<HTMLInputElement>('input', (control) => { control.type = 'text' })
    const number = make<HTMLInputElement>('input', (control) => { control.type = 'number' })
    const textarea = make<HTMLTextAreaElement>('textarea', () => {})
    const select = make<HTMLSelectElement>('select', (control) => control.appendChild(new Option('Choice', 'choice')))
    const editable = make<HTMLDivElement>('div', (control) => { control.contentEditable = 'true'; control.textContent = 'Editable' })
    const controls = [text, number, textarea, select, editable]
    const keys = ['c', 'x', 'v', 'd', 'c']
    const apple = /Mac|iPhone|iPad|iPod/u.test(navigator.platform)
    return controls.map((control, index) => {
      control.focus()
      const event = new KeyboardEvent('keydown', {
        key: keys[index], bubbles: true, composed: true, cancelable: true,
        ctrlKey: !apple, metaKey: apple,
      })
      control.dispatchEvent(event)
      return event.defaultPrevented
    })
  })
  expect(defaultPrevented).toEqual([false, false, false, false, false])
  await expect(editor.locator('.graph-placement-preview')).toHaveCount(0)
  await expect(editor.locator('.node')).toHaveCount(1)
})

test('node More and graph context menus use effective selection and deferred placement', async ({ page }) => {
  const { editor, bounds } = await ready(page)
  await dropNode(page, 'cube', { x: bounds.x + 100, y: bounds.y + 100 })
  await dropNode(page, 'sphere', { x: bounds.x + 390, y: bounds.y + 100 })
  const cube = editor.locator('.node[data-node-type="cube"]')
  const sphere = editor.locator('.node[data-node-type="sphere"]')
  await clickNode(cube)
  await clickNode(sphere, ['Shift'])

  await cube.locator('.node-more-summary').click()
  await expect(cube.getByRole('menuitem', { name: 'Copy', exact: true })).toBeVisible()
  await expect(cube.getByRole('menuitem', { name: 'Cut', exact: true })).toBeVisible()
  await cube.getByRole('menuitem', { name: 'Copy', exact: true }).click()
  await graphShortcut(page, 'V')
  await expect(editor.locator('.graph-placement-preview-node')).toHaveCount(1)
  await page.keyboard.press('Escape')

  // Right-clicking an unselected node replaces selection.
  await page.mouse.click(bounds.x + bounds.width - 30, bounds.y + bounds.height - 30)
  await clickNode(cube)
  const sphereBox = await waitForBoundingBox(sphere)
  await page.mouse.click(sphereBox.x + 30, sphereBox.y + 20, { button: 'right' })
  const menu = editor.locator('.graph-context-menu')
  await expect(menu).toBeVisible()
  await expect(sphere).toHaveClass(/node--selected/)
  await expect(cube).not.toHaveClass(/node--selected/)
  await expect(menu.getByRole('menuitem', { name: 'Copy', exact: true })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(menu).toHaveCount(0)
  await expect(editor.locator('#canvas')).toBeFocused()

  // Right-clicking a selected member preserves the complete selection.
  await clickNode(cube)
  await clickNode(sphere, ['Shift'])
  const cubeBox = await waitForBoundingBox(cube)
  await page.mouse.click(cubeBox.x + 30, cubeBox.y + 20, { button: 'right' })
  await expect(cube).toHaveClass(/node--selected/)
  await expect(sphere).toHaveClass(/node--selected/)
  await menu.getByRole('menuitem', { name: 'Duplicate', exact: true }).click()
  await expect(editor.locator('.graph-placement-preview-node')).toHaveCount(2)
  await expect(editor.locator('.node')).toHaveCount(2)
  await page.keyboard.press('Escape')

  // Empty-canvas context has Paste only and starts at its invocation point.
  await page.mouse.click(bounds.x + bounds.width - 70, bounds.y + bounds.height - 70, { button: 'right' })
  await expect(menu).toBeVisible()
  await expect(menu.getByRole('menuitem', { name: 'Copy', exact: true })).toHaveCount(0)
  await menu.getByRole('menuitem', { name: 'Paste', exact: true }).click()
  await expect(editor.locator('.graph-placement-preview-node')).toHaveCount(1)
  await page.mouse.click(bounds.x + bounds.width - 70, bounds.y + bounds.height - 70)
  await expect(editor.locator('.node')).toHaveCount(3)

  // Keyboard invocation gets the same menu and Escape lifecycle.
  await page.locator('node-editor #canvas').press('Shift+F10')
  await expect(menu).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(menu).toHaveCount(0)
  await waitForUiCommit(page)

  // A deliberate touch hold opens the same menu; movement beyond the drag
  // threshold cancels it so ordinary canvas panning remains available.
  await editor.locator('#canvas').dispatchEvent('pointerdown', {
    pointerId: 81, pointerType: 'touch', button: 0, buttons: 1,
    clientX: bounds.x + bounds.width - 100, clientY: bounds.y + bounds.height - 100,
  })
  await page.waitForTimeout(600)
  await expect(menu).toBeVisible()
  await editor.locator('#canvas').dispatchEvent('pointerup', {
    pointerId: 81, pointerType: 'touch', button: 0,
    clientX: bounds.x + bounds.width - 100, clientY: bounds.y + bounds.height - 100,
  })
  await page.keyboard.press('Escape')

  await editor.locator('#canvas').dispatchEvent('pointerdown', {
    pointerId: 82, pointerType: 'touch', button: 0, buttons: 1,
    clientX: bounds.x + 80, clientY: bounds.y + bounds.height - 100,
  })
  await editor.locator('#canvas').dispatchEvent('pointermove', {
    pointerId: 82, pointerType: 'touch', button: 0, buttons: 1,
    clientX: bounds.x + 110, clientY: bounds.y + bounds.height - 100,
  })
  await page.waitForTimeout(600)
  await expect(menu).toHaveCount(0)
  await editor.locator('#canvas').dispatchEvent('pointerup', {
    pointerId: 82, pointerType: 'touch', button: 0,
    clientX: bounds.x + 110, clientY: bounds.y + bounds.height - 100,
  })

  const movedSphereBox = await waitForBoundingBox(sphere)
  await sphere.dispatchEvent('pointerdown', {
    pointerId: 83, pointerType: 'touch', button: 0, buttons: 1,
    clientX: movedSphereBox.x + 24, clientY: movedSphereBox.y + 18,
  })
  await sphere.dispatchEvent('pointermove', {
    pointerId: 83, pointerType: 'touch', button: 0, buttons: 1,
    clientX: movedSphereBox.x + 48, clientY: movedSphereBox.y + 18,
  })
  await page.waitForTimeout(600)
  await expect(menu).toHaveCount(0)
  await sphere.dispatchEvent('pointerup', {
    pointerId: 83, pointerType: 'touch', button: 0,
    clientX: movedSphereBox.x + 48, clientY: movedSphereBox.y + 18,
  })
})

test('bound Values and bodyless For closures paste with fresh identities and remapped references', async ({ page }) => {
  const { editor, bounds } = await ready(page)
  await editor.evaluate(async (element, box) => {
    const instance = (element as unknown as { getEditorInstance(): {
      addNodeAt(type: string, position: { x: number; y: number }, params?: Record<string, unknown>): Promise<void>
      addVariableReferenceAt(bindingId: string, sourceNodeId: string, position: { x: number; y: number }): Promise<boolean>
      editor: { getNodes(): Array<{ id: string; label: string; bindingId?: string; getBindingId?: () => string | undefined }> }
    } }).getEditorInstance()
    const valueBinding = crypto.randomUUID()
    await instance.addNodeAt('number', { x: box.x + 70, y: box.y + 80 }, { value: 4, name: 'width', bindingId: valueBinding })
    const value = instance.editor.getNodes().find((node) => node.getBindingId?.() === valueBinding)!
    await instance.addVariableReferenceAt(valueBinding, value.id, { x: box.x + 300, y: box.y + 80 })
    await instance.addNodeAt('for', { x: box.x + 70, y: box.y + 330 })
    const header = instance.editor.getNodes().find((node) => node.label === 'For')!
    await instance.addVariableReferenceAt(header.bindingId!, header.id, { x: box.x + 300, y: box.y + 330 })
  }, bounds)

  await clickNode(editor.locator('.node[data-node-type="number"]'))
  await clickNode(editor.locator('.node[data-node-type="variable-reference"]', { hasText: 'width' }), ['Shift'])
  await clickNode(editor.locator('.node[data-node-type="for"]'), ['Shift'])
  await expect(editor.locator('.node.node--selected')).toHaveCount(3)
  await graphShortcut(page, 'C')
  await graphShortcut(page, 'V')
  await expect(editor.locator('.graph-placement-preview-node')).toHaveCount(5)
  await page.mouse.click(bounds.x + bounds.width - 190, bounds.y + bounds.height - 150)
  await expect(editor.locator('.node')).toHaveCount(10)
  await expect(editor.locator('.node.node--selected')).toHaveCount(5)

  const identities = await editor.evaluate((element) => {
    const graph = (element as unknown as { getEditorInstance(): { editor: {
      getNodes(): Array<{ label: string; bindingId?: string; pairId?: string; getBindingId?: () => string | undefined; getBindingName?: () => string; getBindingType?: () => string }>
      getConnections(): Array<{ id: string; sourceOutput: string; targetInput: string }>
    } } }).getEditorInstance().editor
    return {
      values: graph.getNodes().filter((node) => node.label === 'Number' && node.getBindingId?.())
        .map((node) => ({ id: node.getBindingId!(), name: node.getBindingName!() })),
      headers: graph.getNodes().filter((node) => node.label === 'For')
        .map((node) => ({ pairId: node.pairId!, bindingId: node.bindingId! })),
      results: graph.getNodes().filter((node) => node.label === 'For result').map((node) => node.pairId!),
      references: graph.getNodes().filter((node) => typeof node.getBindingType === 'function').map((node) => node.bindingId!),
      structures: graph.getConnections().filter((edge) => edge.sourceOutput === 'loop' && edge.targetInput === 'loop').map((edge) => edge.id),
    }
  })
  expect(identities.values.map((value) => value.name).sort()).toEqual(['width', 'width_copy'])
  expect(new Set(identities.values.map((value) => value.id)).size).toBe(2)
  expect(new Set(identities.headers.map((header) => header.pairId)).size).toBe(2)
  expect(new Set(identities.headers.map((header) => header.bindingId)).size).toBe(2)
  expect(new Set(identities.results)).toEqual(new Set(identities.headers.map((header) => header.pairId)))
  expect(new Set(identities.references)).toEqual(new Set([
    ...identities.values.map((value) => value.id), ...identities.headers.map((header) => header.bindingId),
  ]))
  expect(new Set(identities.structures).size).toBe(2)
})

test('cut, singleton rejection, scope changes, and project changes preserve clipboard safety', async ({ page }) => {
  const { editor, bounds } = await ready(page)
  await dropNode(page, 'cube', { x: bounds.x + 120, y: bounds.y + 120 })
  const cube = editor.locator('.node[data-node-type="cube"]')
  await clickNode(cube)
  const originalId = await cube.getAttribute('data-node-id')
  await graphShortcut(page, 'X')
  await expect(editor.locator('.node[data-node-type="cube"]')).toHaveCount(0)
  await graphShortcut(page, 'V')
  await expect(editor.locator('.graph-placement-preview-node')).toHaveCount(1)
  await page.keyboard.press('Escape')
  await expect(editor.locator('.node')).toHaveCount(0)
  await graphShortcut(page, 'V')
  await page.mouse.click(bounds.x + 330, bounds.y + 210)
  await expect(editor.locator('.node[data-node-type="cube"]')).toHaveCount(1)
  await expect(editor.locator('.node[data-node-type="cube"]')).not.toHaveAttribute('data-node-id', originalId ?? '')
  await expect(editor.locator('.node.node--selected')).toHaveCount(1)

  await dropNode(page, 'scad-settings', { x: bounds.x + 570, y: bounds.y + 120 })
  const settings = editor.locator('.node[data-node-type="scad-settings"]')
  await clickNode(settings)
  await graphShortcut(page, 'C')
  await graphShortcut(page, 'V')
  await expect(editor.locator('.graph-placement-preview')).toHaveCount(0)
  await expect(editor.locator('.editor-feedback')).toContainText('Only one SCAD settings node')
  // This singleton can sit partly beneath the resizable viewer at the chosen
  // graph coordinate. Trigger its native summary activation directly; menu
  // behaviour, not pointer hit-testing through the splitter, is under test.
  await settings.locator('.node-more-summary').dispatchEvent('click')
  await expect(settings.getByRole('menuitem', { name: /Duplicate:/ })).toBeDisabled()
  await page.keyboard.press('Escape')

  // Main placement is cancelled when the active semantic scope changes, and
  // the retained payload remains unavailable until Main is active again.
  await clickNode(editor.locator('.node[data-node-type="cube"]'))
  await graphShortcut(page, 'C')
  await graphShortcut(page, 'V')
  await expect(editor.locator('.graph-placement-preview')).toBeVisible()
  const moduleId = await editor.evaluate(async (element) => {
    const instance = (element as unknown as { getEditorInstance(): { createModule(name: string): Promise<{ id: string }>; focusModule(id: string): Promise<void> } }).getEditorInstance()
    const definition = await instance.createModule('clipboard_scope')
    await instance.focusModule(definition.id)
    return definition.id
  })
  expect(moduleId).toBeTruthy()
  await expect(editor.locator('.graph-placement-preview')).toHaveCount(0)
  await graphShortcut(page, 'V')
  await expect(editor.locator('.graph-placement-preview')).toHaveCount(0)
  await expect(editor.locator('.editor-feedback')).toContainText('Return to the scope')
  const interfaceNode = editor.locator('.node[data-node-type="module-inputs"]')
  const interfaceBox = await waitForBoundingBox(interfaceNode)
  await page.mouse.click(interfaceBox.x + 24, interfaceBox.y + 18, { button: 'right' })
  await expect(editor.locator('.graph-context-menu').getByRole('menuitem', { name: /Copy: Definition interface/ })).toBeDisabled()
  await page.keyboard.press('Escape')

  // A committed project switch also cancels placement and keeps the old
  // clipboard payload isolated from the new project.
  await page.mouse.click(bounds.x + bounds.width - 30, bounds.y + bounds.height - 30)
  await graphShortcut(page, 'V')
  await expect(editor.locator('.graph-placement-preview')).toBeVisible()
  await page.getByRole('button', { name: 'Projects' }).click()
  await page.getByRole('button', { name: 'New project', exact: true }).click()
  await expect(editor.locator('.node')).toHaveCount(0)
  await expect(editor.locator('.graph-placement-preview')).toHaveCount(0)
  await page.keyboard.press('Escape')
  await editor.locator('#canvas').click({ position: { x: 100, y: 100 } })
  await graphShortcut(page, 'V')
  await expect(editor.locator('.graph-placement-preview')).toHaveCount(0)
  await expect(editor.locator('.editor-feedback')).toContainText('Return to the project')
})

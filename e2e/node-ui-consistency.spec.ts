import { expect, test, type Page } from '@playwright/test'

/**
 * Covers the shared node-UI-consistency work (node-style.md): the shared
 * header anatomy/action order, palette icon-plus-label entries, the header
 * More menu exposing only applicable actions per node kind, and the
 * restyled Module/Function definition frames. Value-node Rename itself and
 * the Geometry-vs-value background identity are covered in depth by
 * `geometry-accent.spec.ts`/`local-persistence.spec.ts`; this file adds the
 * remaining focused coverage plus one end-to-end regression walkthrough.
 */

async function waitForLocalLibrary(page: Page) {
  await page.goto('/')
  await expect(page.locator('scadlet-app .project-name')).toBeEnabled()
}

async function dropPaletteNode(page: Page, type: string, position?: { x: number; y: number }): Promise<void> {
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

async function definitionInputs(page: Page, definitionId: string): Promise<Locator> {
  const inputsNodeId = await page.locator('node-editor').evaluate((element, id) => {
    const editor = (element as unknown as { getEditorInstance(): { getDefinitions(): { id: string; inputsNodeId: string }[] } }).getEditorInstance()
    return editor.getDefinitions().find((definition) => definition.id === id)?.inputsNodeId
  }, definitionId)
  if (!inputsNodeId) throw new Error('Expected definition Inputs node id')
  return page.locator(`node-editor .node[data-node-id="${inputsNodeId}"]`)
}

async function addNumberParameter(inputs: Locator, name: string): Promise<void> {
  await inputs.locator('.node-add-summary').click()
  await inputs.getByRole('button', { name: 'Parameter', exact: true }).click()
  const popover = inputs.locator('.node-parameter-popover')
  await popover.getByLabel('Name', { exact: true }).fill(name)
  await popover.getByRole('button', { name: 'Add', exact: true }).click()
}

async function dropDefinitionCall(page: Page, type: 'module' | 'function', definitionId: string, point: { x: number; y: number }): Promise<void> {
  await page.locator('node-editor').evaluate((element, input) => {
    const canvas = element.shadowRoot?.querySelector('#canvas')
    if (!canvas) throw new Error('Expected node-editor canvas')
    const dataTransfer = new DataTransfer()
    dataTransfer.setData(input.type === 'module' ? 'application/x-scadlet-module-call' : 'application/x-scadlet-function-call', input.definitionId)
    canvas.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, clientX: input.x, clientY: input.y, dataTransfer }))
    canvas.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, clientX: input.x, clientY: input.y, dataTransfer }))
  }, { type, definitionId, ...point })
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

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    Object.defineProperty(window, 'showOpenFilePicker', { value: undefined, configurable: true })
    Object.defineProperty(window, 'showSaveFilePicker', { value: undefined, configurable: true })
  })
})

test('shared header exposes icon, title, More, and Collapse in order with accessible names and keyboard focus', async ({ page }) => {
  await waitForLocalLibrary(page)
  await dropPaletteNode(page, 'translate')
  const translate = page.locator('node-editor .node').filter({ has: page.locator('.node-title', { hasText: 'Translate' }) })
  await expect(translate).toHaveCount(1)

  const order = await translate.locator('.node-header').evaluate((header) =>
    Array.from(header.children).map((child) => child.className || child.tagName.toLowerCase()),
  )
  expect(order[0]).toBe('node-header-icon')
  expect(order.at(-2)).toBe('node-more-menu')
  expect(order.at(-1)).toBe('node-collapse')

  await expect(translate.locator('.node-header-icon svg')).toHaveCount(1)
  await expect(translate.locator('.node-more-summary')).toHaveAttribute('aria-label', 'More actions')
  await expect(translate.locator('.node-more-summary')).toHaveAttribute('title', 'More actions')
  await expect(translate.getByRole('button', { name: 'Collapse node' })).toHaveAttribute('title', 'Collapse node')

  // Both header action buttons meet the project's minimum touch target and
  // provide a visible keyboard focus ring.
  for (const control of [translate.locator('.node-more-summary'), translate.getByRole('button', { name: 'Collapse node' })]) {
    const box = await control.boundingBox()
    expect(box?.width).toBeGreaterThanOrEqual(32)
    expect(box?.height).toBeGreaterThanOrEqual(32)
  }
  await translate.locator('.node-more-summary').focus()
  await expect(translate.locator('.node-more-summary')).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(translate.getByRole('button', { name: 'Collapse node' })).toBeFocused()
})

test('Module and Function Calls show only their definition names while retaining distinct accessible call types and header actions', async ({ page }) => {
  await waitForLocalLibrary(page)
  const canvas = await page.locator('node-editor').boundingBox()
  if (!canvas) throw new Error('Expected node-editor canvas')

  const createDefinition = async (kind: 'module' | 'function', name: string) => {
    await page.getByRole('button', { name: `+ New ${kind}`, exact: true }).click()
    const dialog = page.getByRole('form', { name: `Create ${kind}` })
    await dialog.getByLabel(`${kind === 'module' ? 'Module' : 'Function'} name`).fill(name)
    await dialog.getByRole('button', { name: 'Create', exact: true }).click()
    const frame = page.locator('node-editor .definition-frame').filter({ hasText: name })
    const definitionId = await frame.getAttribute('data-definition-id')
    if (!definitionId) throw new Error(`Expected ${kind} definition id`)
    return { frame, definitionId }
  }

  const module = await createDefinition('module', 'housing')
  await addNumberParameter(await definitionInputs(page, module.definitionId), 'wall')
  await dropDefinitionCall(page, 'module', module.definitionId, { x: canvas.x + 100, y: canvas.y + canvas.height - 100 })
  const moduleCall = page.locator('node-editor .node').filter({ has: page.locator('.node-title', { hasText: 'housing' }) })
  await expect(moduleCall).toHaveCount(1)

  const functionDefinition = await createDefinition('function', 'taper')
  await addNumberParameter(await definitionInputs(page, functionDefinition.definitionId), 'ratio')
  const functionFrameBox = await functionDefinition.frame.boundingBox()
  if (!functionFrameBox) throw new Error('Expected Function definition frame')
  await dropPaletteNode(page, 'number', { x: functionFrameBox.x + functionFrameBox.width / 2, y: functionFrameBox.y + functionFrameBox.height / 2 })
  const functionValue = page.locator('node-editor .node').filter({ has: page.locator('.node-title[aria-label="Number Name"]') })
  const outputNodeId = await page.locator('node-editor').evaluate((element, id) => {
    const editor = (element as unknown as { getEditorInstance(): { getDefinitions(): { id: string; outputNodeId: string }[] } }).getEditorInstance()
    return editor.getDefinitions().find((definition) => definition.id === id)?.outputNodeId
  }, functionDefinition.definitionId)
  if (!outputNodeId) throw new Error('Expected Function Output node id')
  await connect(page, functionValue.locator('.node-port--output .node-socket'), page.locator(`node-editor .node[data-node-id="${outputNodeId}"] .node-port--input .node-socket`))
  await dropDefinitionCall(page, 'function', functionDefinition.definitionId, { x: canvas.x + 330, y: canvas.y + canvas.height - 100 })
  const functionCall = page.locator('node-editor .node').filter({ has: page.locator('.node-title', { hasText: 'taper' }) })
  await expect(functionCall).toHaveCount(1)

  for (const [call, type, name] of [[moduleCall, 'Module call', 'housing'], [functionCall, 'Function call', 'taper']] as const) {
    const title = call.locator('.node-title')
    await expect(title).toHaveText(name)
    await expect(title).toHaveAttribute('role', 'heading')
    await expect(title).toHaveAttribute('aria-label', `${type}: ${name}`)
    await expect(title).toHaveAttribute('title', `${type}: ${name}`)
    const order = await call.locator('.node-header').evaluate((header) => Array.from(header.children).map((child) => child.className))
    expect(order).toEqual(['node-header-icon', 'node-title', 'node-more-menu', 'node-collapse'])
    await expect(call.locator('.node-header-icon svg')).toHaveCount(1)
    await expect(call.locator('.node-more-summary')).toHaveAttribute('aria-label', 'More actions')
    await expect(call.getByRole('button', { name: 'Collapse node' })).toHaveAttribute('aria-expanded', 'true')
    // The output socket overlays this compact fixture at its deliberately
    // tight canvas position. Invoke the already-rendered header control
    // directly here; pointer delivery for Collapse is covered separately.
    await call.getByRole('button', { name: 'Collapse node' }).evaluate((button: HTMLButtonElement) => button.click())
    await expect(call.getByRole('button', { name: 'Expand node' })).toHaveAttribute('aria-expanded', 'false')
    await call.getByRole('button', { name: 'Expand node' }).evaluate((button: HTMLButtonElement) => button.click())
  }

  const [moduleIcon, functionIcon] = await Promise.all([
    moduleCall.locator('.node-header-icon path').getAttribute('d'),
    functionCall.locator('.node-header-icon path').getAttribute('d'),
  ])
  expect(moduleIcon).not.toBe(functionIcon)
})

test('More menu exposes only the actions applicable to each node kind', async ({ page }) => {
  await waitForLocalLibrary(page)
  const canvas = await page.locator('node-editor').boundingBox()
  if (!canvas) throw new Error('Expected node-editor canvas')

  // A plain geometry node (no user-editable name): Inspect and Delete, no Rename.
  await dropPaletteNode(page, 'difference', { x: canvas.x + 120, y: canvas.y + 120 })
  const difference = page.locator('node-editor .node').filter({ has: page.locator('.node-title', { hasText: 'Difference' }) })
  await difference.locator('.node-more-summary').click()
  await expect(difference.getByRole('menuitem', { name: 'Inspect' })).toHaveCount(1)
  await expect(difference.getByRole('menuitem', { name: 'Rename' })).toHaveCount(0)
  const deleteAction = difference.getByRole('menuitem', { name: 'Delete' })
  await expect(deleteAction).toHaveCount(1)
  await expect(deleteAction).toHaveClass(/node-more-item--destructive/)

  // A renameable Value node: Inspect, Rename (pencil icon), and destructive Delete.
  await dropPaletteNode(page, 'number', { x: canvas.x + 360, y: canvas.y + 120 })
  const number = page.locator('node-editor .node').filter({ has: page.locator('.node-title[aria-label="Number Name"]') })
  await number.locator('.node-more-summary').click()
  await expect(number.getByRole('menuitem', { name: 'Rename' })).toHaveCount(1)
  await expect(number.getByRole('menuitem', { name: 'Rename' }).locator('svg')).toHaveCount(1)
  await expect(number.getByRole('menuitem', { name: 'Inspect' })).toHaveCount(1)
  await expect(number.getByRole('menuitem', { name: 'Delete' })).toHaveCount(1)

  // Fixed compact interfaces still expose Delete/Inspect but never Collapse.
  await dropPaletteNode(page, 'conditional', { x: canvas.x + 120, y: canvas.y + 260 })
  const conditional = page.locator('node-editor .node').filter({ has: page.locator('.node-title', { hasText: 'Conditional' }) })
  await expect(conditional.locator('.node-collapse')).toHaveCount(0)
  await conditional.locator('.node-more-summary').click()
  await expect(conditional.getByRole('menuitem', { name: 'Rename' })).toHaveCount(0)
  await expect(conditional.getByRole('menuitem', { name: 'Delete' })).toHaveCount(1)

  // The protected Inputs/Output interface nodes never get a More menu at all.
  await page.getByRole('button', { name: '+ New module', exact: true }).click()
  const dialog = page.getByRole('form', { name: 'Create module' })
  await dialog.getByLabel('Module name').fill('consistency_check')
  await dialog.getByRole('button', { name: 'Create', exact: true }).click()
  const inputs = page.locator('node-editor .node').filter({ has: page.locator('.node-title', { hasText: 'Inputs' }) })
  const output = page.locator('node-editor .node').filter({ has: page.locator('.node-title', { hasText: 'Output' }) })
  await expect(inputs.locator('.node-more-menu')).toHaveCount(0)
  await expect(output.locator('.node-more-menu')).toHaveCount(0)
})

test('palette entries show a matching icon immediately before every readable node-type label', async ({ page }) => {
  await waitForLocalLibrary(page)
  const palette = page.locator('node-palette')
  for (const [type, label] of [['cube', 'Cube'], ['translate', 'Translate'], ['union', 'Union'], ['number', 'Number'], ['compare', 'Compare'], ['conditional', 'Conditional']] as const) {
    const entry = palette.locator(`.node-item[data-node-type="${type}"]`)
    await expect(entry).toHaveAttribute('aria-label', label)
    const icon = entry.locator('.node-item-icon')
    await expect(icon).toHaveCount(1)
    await expect(icon.locator('svg')).toHaveCount(1)
    // The icon precedes the label text within the same entry (icon-then-label order).
    const order = await entry.evaluate((element) => {
      const icon = element.querySelector('.node-item-icon')
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
      let firstTextNode: Node | null = null
      while (walker.nextNode()) { if (walker.currentNode.textContent?.trim()) { firstTextNode = walker.currentNode; break } }
      return icon && firstTextNode ? (icon.compareDocumentPosition(firstTextNode) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0 : false
    })
    expect(order).toBe(true)
  }

  // Two different node families (a Geometry primitive and a Value node) use
  // visibly distinct icons, matching their node-family identity.
  const cubeIconPath = await palette.locator('.node-item[data-node-type="cube"] .node-item-icon svg path').getAttribute('d')
  const numberIconPath = await palette.locator('.node-item[data-node-type="number"] .node-item-icon svg path').getAttribute('d')
  expect(cubeIconPath).not.toBe(numberIconPath)

  // Boolean glyphs use bright filled result areas; Intersection and Difference
  // retain two visibly subdued input shapes behind their specific result.
  for (const type of ['union', 'intersection', 'difference']) {
    const icon = palette.locator(`.node-item[data-node-type="${type}"] .boolean-operation-icon`)
    await expect(icon).toHaveClass(new RegExp(`boolean-operation-icon--${type}`))
    await expect(icon.locator('.boolean-operation-icon__result')).toHaveCount(type === 'union' ? 2 : 1)
    await expect(icon.locator('.boolean-operation-icon__input')).toHaveCount(type === 'union' ? 0 : 2)
  }
  await expect(palette.locator('.boolean-operation-icon__input').first()).toHaveAttribute('fill', '#8f8f8f')
  await expect(palette.locator('.boolean-operation-icon__result').first()).toHaveAttribute('fill', '#f2f2f2')
  await expect(palette.locator('.boolean-operation-icon__input').first()).toHaveCSS('fill', 'rgb(143, 143, 143)')
  await expect(palette.locator('.boolean-operation-icon__result').first()).toHaveCSS('fill', 'rgb(242, 242, 242)')
  const paintGeometry = await palette.locator('.boolean-operation-icon').evaluateAll((icons) => icons.flatMap((icon) =>
    Array.from(icon.children).map((part) => ({
      namespace: part.namespaceURI,
      width: part.getBoundingClientRect().width,
      height: part.getBoundingClientRect().height,
    })),
  ))
  expect(paintGeometry.every((part) => part.namespace === 'http://www.w3.org/2000/svg')).toBe(true)
  expect(paintGeometry.every((part) => part.width > 0 && part.height > 0)).toBe(true)
  await palette.screenshot({ path: 'test-results/boolean-palette-after.png' })

  for (const type of ['cube', 'union', 'number']) {
    const iconSize = await palette.locator(`.node-item[data-node-type="${type}"] .node-item-icon`).evaluate((icon) => {
      const style = getComputedStyle(icon)
      return { width: style.width, height: style.height }
    })
    expect(iconSize).toEqual({ width: '18px', height: '18px' })
  }
})

test('Module and Function frames use the shared icon/keyword/name hierarchy, never show Add or Collapse, and rename/delete through their own More menu', async ({ page }) => {
  await waitForLocalLibrary(page)
  await page.getByRole('button', { name: '+ New module', exact: true }).click()
  const dialog = page.getByRole('form', { name: 'Create module' })
  await dialog.getByLabel('Module name').fill('bracket')
  await dialog.getByRole('button', { name: 'Create', exact: true }).click()

  const frame = page.locator('node-editor .definition-frame').filter({ hasText: 'bracket' })
  await expect(frame).toHaveCount(1)
  await expect(frame.locator('.definition-frame-icon svg')).toHaveCount(1)
  await expect(frame.locator('.definition-frame-keyword')).toHaveText('Module')
  await expect(frame.locator('.definition-frame-name')).toHaveText('bracket')
  // The name is the visually stronger part of the header.
  const weights = await frame.evaluate((element) => ({
    keyword: Number(getComputedStyle(element.querySelector('.definition-frame-keyword')!).fontWeight),
    name: Number(getComputedStyle(element.querySelector('.definition-frame-name')!).fontWeight),
  }))
  expect(weights.name).toBeGreaterThan(weights.keyword)

  // Frames never show Add or Collapse controls of their own.
  await expect(frame.locator('.node-collapse')).toHaveCount(0)
  await expect(frame.getByText('+', { exact: true })).toHaveCount(0)

  // The frame's own More menu reuses the existing sidebar rename/delete
  // lifecycle rather than a parallel mutation path.
  await frame.locator('.definition-frame-more summary').click()
  await frame.getByRole('menuitem', { name: 'Rename' }).click()
  const renameDialog = page.getByRole('form', { name: 'Rename module' })
  await renameDialog.getByLabel('Module name').fill('enclosure')
  await renameDialog.getByRole('button', { name: 'Save', exact: true }).click()
  const renamedFrame = page.locator('node-editor .definition-frame').filter({ hasText: 'enclosure' })
  await expect(renamedFrame.locator('.definition-frame-name')).toHaveText('enclosure')
  await expect(page.locator('node-palette .module-item')).toHaveText('enclosure')

  page.once('dialog', (confirm) => confirm.accept())
  await renamedFrame.locator('.definition-frame-more summary').click()
  await renamedFrame.getByRole('menuitem', { name: 'Delete' }).click()
  await expect(page.locator('node-editor .definition-frame')).toHaveCount(0)
  await expect(page.locator('node-palette .module-item')).toHaveCount(0)
})

test('regression: palette icons, Geometry-versus-value styling, Value-node rename, a Function frame menu, fixed/collapsible exceptions, and a bundled OpenSCAD-WASM render', async ({ page }) => {
  await waitForLocalLibrary(page)
  const canvas = await page.locator('node-editor').boundingBox()
  if (!canvas) throw new Error('Expected node-editor canvas')

  // Palette icons are present before every visible label.
  await expect(page.locator('node-palette .node-item[data-node-type="cube"] .node-item-icon svg')).toHaveCount(1)
  await expect(page.locator('node-palette .node-item[data-node-type="number"] .node-item-icon svg')).toHaveCount(1)

  await dropPaletteNode(page, 'cube', { x: canvas.x + 120, y: canvas.y + 120 })
  await dropPaletteNode(page, 'number', { x: canvas.x + 380, y: canvas.y + 120 })
  const cube = page.locator('node-editor .node').filter({ has: page.locator('.node-title', { hasText: 'Cube' }) })
  const number = page.locator('node-editor .node').filter({ has: page.locator('.node-title[aria-label="Number Name"]') })

  // Geometry identity is a tinted background, distinct from the neutral
  // Value-node card, independent of the Number's output type.
  const [cubeBackground, numberBackground] = await Promise.all([
    cube.evaluate((element) => getComputedStyle(element).backgroundColor),
    number.evaluate((element) => getComputedStyle(element).backgroundColor),
  ])
  expect(cubeBackground).toBe('rgb(44, 53, 64)')
  expect(numberBackground).toBe('rgb(42, 42, 42)')
  expect(cubeBackground).not.toBe(numberBackground)

  // Value-node Rename: title is plain text until the More menu's Rename
  // is used, then commits through Enter with the full text preselected.
  await expect(number.locator('input.node-title')).toHaveCount(0)
  await number.locator('.node-more-summary').click()
  await number.getByRole('menuitem', { name: 'Rename' }).click()
  const renameInput = number.locator('input.node-title')
  await expect(renameInput).toBeFocused()
  const selection = await renameInput.evaluate((element: HTMLInputElement) => element.value.slice(element.selectionStart ?? 0, element.selectionEnd ?? 0))
  expect(selection).toBe('Number')
  await renameInput.fill('Depth')
  await renameInput.press('Enter')
  await expect(number.locator('.node-title')).toHaveText('Depth')

  // A Function definition frame restyles the same way and exposes its own
  // More menu.
  await page.getByRole('button', { name: '+ New function', exact: true }).click()
  const functionDialog = page.getByRole('form', { name: 'Create function' })
  await functionDialog.getByLabel('Function name').fill('scaled')
  await functionDialog.getByRole('button', { name: 'Create', exact: true }).click()
  const functionFrame = page.locator('node-editor .definition-frame').filter({ hasText: 'scaled' })
  await expect(functionFrame.locator('.definition-frame-keyword')).toHaveText('Function')
  await expect(functionFrame.locator('.definition-frame-icon svg')).toHaveCount(1)
  await functionFrame.locator('.definition-frame-more summary').click()
  await expect(functionFrame.getByRole('menuitem', { name: 'Rename' })).toHaveCount(1)
  await expect(functionFrame.getByRole('menuitem', { name: 'Delete' })).toHaveCount(1)
  await page.keyboard.press('Escape')

  // Normally collapsible nodes keep Collapse once a parameter category has
  // been added; Value Conditional/Geometry If remain fixed, compact
  // interfaces with no such control regardless.
  await cube.locator('.node-add-summary').click()
  await cube.getByRole('button', { name: 'Center', exact: true }).click()
  await expect(cube.locator('.node-collapse')).toHaveCount(1)
  await dropPaletteNode(page, 'conditional', { x: canvas.x + 620, y: canvas.y + 120 })
  const conditional = page.locator('node-editor .node').filter({ has: page.locator('.node-title', { hasText: 'Conditional' }) })
  await expect(conditional.locator('.node-collapse')).toHaveCount(0)
  await dropPaletteNode(page, 'if', { x: canvas.x + 860, y: canvas.y + 120 })
  const ifNode = page.locator('node-editor .node').filter({ has: page.locator('.node-title', { hasText: 'If' }) })
  await expect(ifNode.locator('.node-collapse')).toHaveCount(0)

  // The shared visual restyle does not affect generated source or a real,
  // bundled OpenSCAD-WASM render.
  await page.getByRole('button', { name: 'Render', exact: true }).click()
  await expect(page.locator('scadlet-app .scad-output')).toContainText('cube(', { timeout: 15_000 })
  const trigger = page.locator('scadlet-app header').getByRole('button', { name: /^File\b/ })
  await trigger.click()
  await expect(page.getByRole('menuitem', { name: 'Download .stl', exact: true })).toBeEnabled({ timeout: 15_000 })
})

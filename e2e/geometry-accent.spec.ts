import { expect, test, type Locator, type Page } from '@playwright/test'

async function openEmptyProject(page: Page): Promise<void> {
  await page.goto('/')
  await expect(page.locator('scadlet-app .project-name')).toBeEnabled()
  await page.getByRole('button', { name: 'Projects' }).click()
  await expect(page.locator('scadlet-app .project-row')).toHaveCount(1)
  await page.keyboard.press('Escape')
}

async function fileAction(page: Page, name: string) {
  const trigger = page.locator('scadlet-app header').getByRole('button', { name: /^File\b/ })
  if (await trigger.getAttribute('aria-expanded') !== 'true') await trigger.click()
  return page.getByRole('menuitem', { name, exact: true })
}

async function dropPaletteNode(page: Page, type: string, point: { x: number; y: number }): Promise<void> {
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

async function dropModuleCall(page: Page, definitionId: string, point: { x: number; y: number }): Promise<void> {
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

async function nodeWithModelLabel(page: Page, label: string): Promise<Locator> {
  const ids = await page.locator('node-editor').evaluate((element, wanted) =>
    (element as unknown as { getEditorInstance(): { editor: { getNodes(): { id: string; label: string }[] } } })
      .getEditorInstance().editor.getNodes().filter((node) => node.label === wanted).map((node) => node.id),
  label)
  if (ids.length !== 1) throw new Error(`Expected exactly one ${label} node, found ${ids.length}`)
  return page.locator(`node-editor .node[data-node-id="${ids[0]}"]`)
}

async function expectGeometryCue(node: Locator, expected: boolean): Promise<void> {
  await expect(node).toHaveAttribute('data-geometry-output', String(expected))
  await expect(node).toHaveClass(expected ? /node--geometry-output/ : /^(?!.*node--geometry-output).*$/)
  const style = await node.evaluate((element) => {
    const computed = getComputedStyle(element)
    return {
      border: computed.borderTopColor,
      background: computed.backgroundColor,
      shadow: computed.boxShadow,
      selected: element.classList.contains('node--selected'),
    }
  })
  // Geometry identity is a subtle tinted background (node-style.md "Node
  // families and colour"), never the border - the border only ever
  // changes for the separate selection/focus/error/Inspect treatments,
  // independent of Geometry-family identity.
  if (expected) {
    expect(style.background).toBe('rgb(44, 53, 64)')
    expect(style.shadow).not.toContain('inset')
  } else {
    expect(style.background).toBe('rgb(42, 42, 42)')
  }
  if (!style.selected) expect(style.border).toBe('rgb(102, 102, 102)')
}

async function connectSockets(page: Page, source: Locator, target: Locator): Promise<void> {
  await expect(source, 'Expected source socket to be visible').toBeVisible()
  await expect(source, 'Expected source socket to be inside the editor viewport').toBeInViewport()
  await expect(target, 'Expected target socket to be visible').toBeVisible()
  await expect(target, 'Expected target socket to be inside the editor viewport').toBeInViewport()
  const sourceBox = await source.boundingBox()
  const targetBox = await target.boundingBox()
  if (!sourceBox || !targetBox) throw new Error(`Expected visible sockets (source: ${Boolean(sourceBox)}, target: ${Boolean(targetBox)})`)
  await page.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2)
  await page.mouse.down()
  await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height / 2, { steps: 8 })
  await page.mouse.up()
}

async function fitGraph(page: Page, nodes: readonly Locator[]): Promise<void> {
  await page.getByRole('button', { name: 'Fit graph', exact: true }).click()
  const viewport = await page.locator('node-editor').boundingBox()
  if (!viewport) throw new Error('Expected node-editor viewport')
  await expect.poll(async () => {
    const boxes = await Promise.all(nodes.map((node) => node.boundingBox()))
    return boxes.every((box) => box
      && box.x >= viewport.x
      && box.y >= viewport.y
      && box.x + box.width <= viewport.x + viewport.width
      && box.y + box.height <= viewport.y + viewport.height)
  }).toBe(true)
}

/** The visible socket drags above cover interaction; this uses the live
 * editor's ordinary connection pipeline for the dense semantic graph, so
 * this test does not become sensitive to overlapping SVG hit targets. */
async function connectNodePorts(page: Page, source: string, sourceOutput: string, target: string, targetInput: string): Promise<void> {
  const created = await page.locator('node-editor').evaluate(async (element, data) => {
    const editor = (element as unknown as { getEditorInstance(): { editor: {
      getConnections(): unknown[]
      addConnection(connection: unknown): Promise<boolean>
    } } }).getEditorInstance().editor
    const template = editor.getConnections()[0]
    if (!template) throw new Error('Expected a visible socket connection template')
    return editor.addConnection(Object.assign(Object.create(Object.getPrototypeOf(template)), {
      id: crypto.randomUUID(), source: data.source, sourceOutput: data.sourceOutput, target: data.target, targetInput: data.targetInput,
    }))
  }, { source, sourceOutput, target, targetInput })
  expect(created).toBe(true)
}

async function visibleInputPorts(node: Locator): Promise<{ key: string | undefined; type: string | undefined; label: string }[]> {
  return node.locator('.node-main > .node-inputs > .node-port--input').evaluateAll((ports) => ports.map((port) => ({
    key: port.querySelector('.node-socket')?.getAttribute('data-socket-key') ?? undefined,
    type: port.querySelector('.node-socket')?.getAttribute('data-socket-type') ?? undefined,
    label: port.querySelector('.node-port-label')?.textContent ?? '',
  })))
}

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    Object.defineProperty(window, 'showOpenFilePicker', { value: undefined, configurable: true })
    Object.defineProperty(window, 'showSaveFilePicker', { value: undefined, configurable: true })
  })
})

test('renders a restrained Geometry accent for live Geometry outputs and matching palette sources', async ({ page }) => {
  await openEmptyProject(page)

  const palette = page.locator('node-palette')
  for (const type of ['cube', 'translate', 'union']) {
    await expect(palette.locator(`.node-item[data-node-type="${type}"]`)).toHaveClass(/node-item--geometry-output/)
  }
  for (const type of ['number', 'vector3', 'arithmetic', 'compare', 'conditional']) {
    await expect(palette.locator(`.node-item[data-node-type="${type}"]`)).not.toHaveClass(/node-item--geometry-output/)
  }

  const editor = page.locator('node-editor')
  const canvas = await editor.boundingBox()
  if (!canvas) throw new Error('Expected node-editor canvas')
  await dropPaletteNode(page, 'cube', { x: canvas.x + 110, y: canvas.y + 160 })
  await dropPaletteNode(page, 'translate', { x: canvas.x + 110, y: canvas.y + 300 })
  await dropPaletteNode(page, 'difference', { x: canvas.x + 110, y: canvas.y + 450 })
  await dropPaletteNode(page, 'number', { x: canvas.x + 380, y: canvas.y + 160 })
  await dropPaletteNode(page, 'arithmetic', { x: canvas.x + 380, y: canvas.y + 300 })
  await dropPaletteNode(page, 'compare', { x: canvas.x + 380, y: canvas.y + 430 })
  await dropPaletteNode(page, 'conditional', { x: canvas.x + 620, y: canvas.y + 300 })

  const cube = await nodeWithModelLabel(page, 'Cube')
  await expectGeometryCue(cube, true)
  await expectGeometryCue(await nodeWithModelLabel(page, 'Translate'), true)
  await expectGeometryCue(await nodeWithModelLabel(page, 'Difference'), true)
  await expectGeometryCue(await nodeWithModelLabel(page, 'Number'), false)
  await expectGeometryCue(await nodeWithModelLabel(page, 'Arithmetic'), false)
  await expectGeometryCue(await nodeWithModelLabel(page, 'Compare'), false)
  await expectGeometryCue(await nodeWithModelLabel(page, 'Conditional'), false)

  // Selection/focus adds its established selection layer without replacing
  // the complete Geometry border.
  await cube.locator('.node-title').click()
  await expect(cube).toHaveClass(/node--selected/)
  await expectGeometryCue(cube, true)
  await expect.poll(() => cube.evaluate((element) => getComputedStyle(element).boxShadow)).toContain('0px 0px 0px 2px')
  await cube.locator('.node-add-summary').click()
  await cube.getByText('Size', { exact: true }).click()
  await cube.getByRole('button', { name: 'Scalar', exact: true }).click()
  const focusedSize = cube.locator('[data-param-key="size"] input')
  await focusedSize.focus()
  await expect(focusedSize).toBeFocused()
  await expect(cube.getByRole('button', { name: 'Collapse node' })).toHaveAttribute('aria-expanded', 'true')
  await expect(cube.getByRole('button', { name: 'Collapse node' }).locator('svg')).toHaveCount(1)
  await expectGeometryCue(cube, true)

  await page.getByRole('button', { name: '+ New module', exact: true }).click()
  const dialog = page.getByRole('form', { name: 'Create module' })
  await dialog.getByLabel('Module name').fill('accented_module')
  await dialog.getByRole('button', { name: 'Create', exact: true }).click()
  const frame = page.locator('node-editor .definition-frame').filter({ hasText: 'accented_module' })
  const definitionId = await frame.getAttribute('data-definition-id')
  if (!definitionId) throw new Error('Expected Module definition id')
  const inputs = await nodeWithModelLabel(page, 'Inputs')
  await expectGeometryCue(inputs, true)
  await expect(palette.locator('.module-entry[data-definition-id]').locator('.module-item')).toHaveClass(/node-item--geometry-output/)

  await dropModuleCall(page, definitionId, { x: canvas.x + 120, y: canvas.y + 470 })
  await expectGeometryCue(await nodeWithModelLabel(page, 'accented_module'), true)

  // Removing the last dynamic Geometry output immediately returns protected
  // Module Inputs to neutral; this proves the renderer is not caching a
  // classification from its original signature.
  await inputs.getByRole('button', { name: 'Remove Geometry 1', exact: true }).click()
  await expectGeometryCue(inputs, false)
})

test('creates the Geometry If from the Control flow palette with the canonical Geometry cue', async ({ page }) => {
  await openEmptyProject(page)
  const palette = page.locator('node-palette')
  const entry = palette.locator('.node-item[data-node-type="if"]')
  await expect(entry).toHaveClass(/node-item--geometry-output/)
  await expect(entry).toHaveAttribute('draggable', 'true')

  const editor = page.locator('node-editor')
  const canvas = await editor.boundingBox()
  if (!canvas) throw new Error('Expected node-editor canvas')
  await dropPaletteNode(page, 'if', { x: canvas.x + 260, y: canvas.y + 260 })
  const ifNode = await nodeWithModelLabel(page, 'If')
  await expectGeometryCue(ifNode, true)
  await expect(ifNode.locator('.node-socket[data-socket-side="input"][data-socket-key="condition"][data-socket-type="boolean"]')).toHaveCount(1)
  await expect(ifNode.locator('.node-socket[data-socket-side="input"][data-socket-key="then"][data-socket-type="geometry"]')).toHaveCount(1)
  await expect(ifNode.locator('.node-socket[data-socket-side="input"][data-socket-key="else"][data-socket-type="geometry"]')).toHaveCount(1)
  await expect(ifNode.locator('.node-socket[data-socket-side="output"][data-socket-key="geometry"][data-socket-type="geometry"]')).toHaveCount(1)
})

test('keeps Value Conditional and Geometry If as fixed, parallel interfaces through visible creation and rendering', async ({ page }) => {
  await openEmptyProject(page)
  const editor = page.locator('node-editor')
  const canvas = await editor.boundingBox()
  if (!canvas) throw new Error('Expected node-editor canvas')

  // Palette drop is the same visible creation path learners use.
  await dropPaletteNode(page, 'boolean', { x: canvas.x + 45, y: canvas.y + 120 })
  await dropPaletteNode(page, 'number', { x: canvas.x + 45, y: canvas.y + 280 })
  await dropPaletteNode(page, 'conditional', { x: canvas.x + 230, y: canvas.y + 120 })
  await dropPaletteNode(page, 'cube', { x: canvas.x + 420, y: canvas.y + 100 })
  await dropPaletteNode(page, 'sphere', { x: canvas.x + 420, y: canvas.y + 310 })
  await dropPaletteNode(page, 'if', { x: canvas.x + 600, y: canvas.y + 190 })

  const boolean = await nodeWithModelLabel(page, 'Boolean')
  const number = await nodeWithModelLabel(page, 'Number')
  const conditional = await nodeWithModelLabel(page, 'Conditional')
  const cube = await nodeWithModelLabel(page, 'Cube')
  const sphere = await nodeWithModelLabel(page, 'Sphere')
  const ifNode = await nodeWithModelLabel(page, 'If')
  const graphNodes = [boolean, number, conditional, cube, sphere, ifNode]

  // Synthetic palette drops intentionally preserve the current viewport.
  // Frame this dense graph through the product's visible recovery control so
  // every subsequent drag starts on a genuinely visible node surface.
  await fitGraph(page, graphNodes)

  await expect(conditional.locator('.node-collapse')).toHaveCount(0)
  await expect(ifNode.locator('.node-collapse')).toHaveCount(0)
  await expect(conditional.locator('.node-param-rows, .node-controls')).toHaveCount(0)
  await expect(ifNode.locator('.node-param-rows, .node-controls')).toHaveCount(0)
  await expect(visibleInputPorts(conditional)).resolves.toEqual([
    { key: 'condition', type: 'boolean', label: 'Condition' },
    { key: 'true', type: 'unresolved', label: 'Case: True' },
    { key: 'false', type: 'unresolved', label: 'Case: False' },
  ])
  await expect(visibleInputPorts(ifNode)).resolves.toEqual([
    { key: 'condition', type: 'boolean', label: 'Condition' },
    { key: 'then', type: 'geometry', label: 'Case: True' },
    { key: 'else', type: 'geometry', label: 'Case: False' },
  ])
  await expect(conditional.locator('.node-main > .node-outputs .node-socket[data-socket-key="result"][data-socket-type="unresolved"]')).toHaveCount(1)
  await expect(ifNode.locator('.node-main > .node-outputs .node-socket[data-socket-key="geometry"][data-socket-type="geometry"]')).toHaveCount(1)

  const drag = async (node: Locator, dx = 28, dy = 18) => {
    const before = await node.boundingBox()
    const surface = await node.locator('.node-body').boundingBox()
    if (!before || !surface) throw new Error('Expected fixed-node free surface')
    await page.mouse.move(surface.x + 3, surface.y + surface.height / 2)
    await page.mouse.down()
    await page.mouse.move(surface.x + dx, surface.y + surface.height / 2 + dy, { steps: 4 })
    await page.mouse.up()
    const after = await node.boundingBox()
    if (!after) throw new Error('Expected moved fixed node')
    expect(after.x - before.x).toBeCloseTo(dx - 3, 0)
    expect(after.y - before.y).toBeCloseTo(dy, 0)
  }
  await drag(conditional, -110, 18)
  await drag(ifNode)
  // Expanded-by-default nodes occupy more vertical space. Move the Number
  // through the visible node-drag interaction so its output cannot overlap
  // Cube's + Size control later in this dense graph.
  await drag(number, -80, 180)

  // The node drags above are part of the interaction regression, but their
  // pixel deltas must not leave later socket drags dependent on pane width.
  await fitGraph(page, graphNodes)

  // Socket drags stay direct interactions, including Geometry If's optional
  // False branch. They also supply a real Rete connection instance for the
  // dense graph setup below.
  await connectSockets(page, cube.locator('.node-socket[data-socket-side="output"]'), ifNode.locator('.node-socket[data-socket-key="then"]'))
  await connectSockets(page, sphere.locator('.node-socket[data-socket-side="output"]'), ifNode.locator('.node-socket[data-socket-key="else"]'))
  await expect(page.locator('node-editor svg.connection[data-real-connection="true"]')).toHaveCount(2)
  await cube.locator('.node-add-summary').click()
  await cube.getByText('Size', { exact: true }).click()
  await cube.getByRole('button', { name: 'Scalar', exact: true }).click()
  const ids = {
    boolean: await boolean.getAttribute('data-node-id'), number: await number.getAttribute('data-node-id'), conditional: await conditional.getAttribute('data-node-id'),
    cube: await cube.getAttribute('data-node-id'), if: await ifNode.getAttribute('data-node-id'),
  }
  if (Object.values(ids).some((id) => !id)) throw new Error('Expected fixed-node ids')
  await connectNodePorts(page, ids.boolean!, 'value', ids.conditional!, 'condition')
  await connectNodePorts(page, ids.number!, 'value', ids.conditional!, 'true')
  await connectNodePorts(page, ids.number!, 'value', ids.conditional!, 'false')
  await connectNodePorts(page, ids.conditional!, 'result', ids.cube!, 'size')
  await connectNodePorts(page, ids.boolean!, 'value', ids.if!, 'condition')
  await expect(visibleInputPorts(conditional)).resolves.toEqual([
    { key: 'condition', type: 'boolean', label: 'Condition' },
    { key: 'true', type: 'number', label: 'Case: True' },
    { key: 'false', type: 'number', label: 'Case: False' },
  ])

  await page.getByRole('button', { name: 'Render', exact: true }).click()
  const source = page.locator('scadlet-app .scad-output')
  await expect(source).toContainText('cube((false ? 10 : 10));', { timeout: 15_000 })
  await expect(source).toContainText('if (false) {', { timeout: 15_000 })
  await expect(source).toContainText('} else {')
  await expect(source).toContainText('sphere();')
  await expect(await fileAction(page, 'Download .stl')).toBeEnabled({ timeout: 15_000 })
})

test('keeps nodes draggable from free surfaces without visible grab handles or control interference', async ({ page }) => {
  await openEmptyProject(page)
  const editor = page.locator('node-editor')
  const canvas = await editor.boundingBox()
  if (!canvas) throw new Error('Expected node-editor canvas')
  await dropPaletteNode(page, 'arithmetic', { x: canvas.x + 220, y: canvas.y + 180 })
  await dropPaletteNode(page, 'number', { x: canvas.x + 460, y: canvas.y + 180 })
  await dropPaletteNode(page, 'boolean', { x: canvas.x + 460, y: canvas.y + 330 })

  const arithmetic = await nodeWithModelLabel(page, 'Arithmetic')
  const number = await nodeWithModelLabel(page, 'Number')
  const boolean = await nodeWithModelLabel(page, 'Boolean')
  await expect(page.locator('node-editor .node-header-drag')).toHaveCount(0)

  const beforeDrag = await arithmetic.boundingBox()
  const freeBody = await arithmetic.locator('.node-body').boundingBox()
  if (!beforeDrag || !freeBody) throw new Error('Expected Arithmetic node bounds')
  await page.mouse.move(freeBody.x + 2, freeBody.y + freeBody.height / 2)
  await page.mouse.down()
  await page.mouse.move(freeBody.x + 92, freeBody.y + freeBody.height / 2 + 48, { steps: 6 })
  await page.mouse.up()
  const afterDrag = await arithmetic.boundingBox()
  if (!afterDrag) throw new Error('Expected moved Arithmetic node bounds')
  expect(afterDrag.x - beforeDrag.x).toBeCloseTo(90, 0)
  expect(afterDrag.y - beforeDrag.y).toBeCloseTo(48, 0)
  await expect.poll(() => page.evaluate(() => window.getSelection()?.toString() ?? '')).toBe('')

  const position = async (node: Locator) => {
    const box = await node.boundingBox()
    if (!box) throw new Error('Expected node bounds')
    return { x: box.x, y: box.y }
  }
  const expectUnmoved = async (node: Locator, before: { x: number; y: number }) => {
    const after = await position(node)
    expect(after.x).toBeCloseTo(before.x, 0)
    expect(after.y).toBeCloseTo(before.y, 0)
  }

  const arithmeticBeforeControl = await position(arithmetic)
  await arithmetic.locator('select.node-title').selectOption('modulo')
  await expect(arithmetic.locator('select.node-title')).toHaveValue('modulo')
  await expectUnmoved(arithmetic, arithmeticBeforeControl)

  const numberBeforeInput = await position(number)
  // The title is normal text by default; Rename (via the header More menu)
  // opens the inline input, which must still ignore drag gestures exactly
  // like every other in-node control (node-style.md "Value nodes").
  await number.locator('.node-more-summary').click()
  await number.getByRole('menuitem', { name: 'Rename' }).click()
  await number.locator('input.node-title').fill('Width')
  await expectUnmoved(number, numberBeforeInput)
  await number.locator('input.node-title').press('Enter')
  await expect(number.locator('.node-title')).toHaveText('Width')

  const numberBeforeValue = await position(number)
  await number.locator('[data-param-key="value"] input[type="number"]').fill('12')
  await expectUnmoved(number, numberBeforeValue)

  const booleanBeforeCheckbox = await position(boolean)
  await boolean.locator('[data-param-key="value"] input[type="checkbox"]').check()
  await expect(boolean.locator('[data-param-key="value"] input[type="checkbox"]')).toBeChecked()
  await expectUnmoved(boolean, booleanBeforeCheckbox)

  const collapseBefore = await position(arithmetic)
  await arithmetic.getByRole('button', { name: 'Collapse node' }).click()
  await expect(arithmetic.getByRole('button', { name: 'Expand node' })).toHaveAttribute('aria-expanded', 'false')
  await expect(arithmetic.getByRole('button', { name: 'Expand node' }).locator('svg')).toHaveCount(1)
  await expectUnmoved(arithmetic, collapseBefore)
})

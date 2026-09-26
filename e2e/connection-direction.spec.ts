import { expect, test, type Locator, type Page } from './fixtures'
import { waitForBoundingBox, waitForUiCommit } from './support'

async function ready(page: Page): Promise<void> {
  await page.goto('/')
  await expect(page.getByRole('textbox', { name: 'Project name' })).toBeEnabled()
  await page.getByRole('switch', { name: 'Live render', exact: true }).click()
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

async function dropDefinitionCall(page: Page, kind: 'module' | 'function', definitionId: string, point: { x: number; y: number }): Promise<void> {
  await page.locator('node-editor').evaluate((element, input) => {
    const canvas = element.shadowRoot?.querySelector('#canvas')
    if (!canvas) throw new Error('Expected node-editor canvas')
    const dataTransfer = new DataTransfer()
    dataTransfer.setData(input.kind === 'module' ? 'application/x-scadlet-module-call' : 'application/x-scadlet-function-call', input.definitionId)
    canvas.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, clientX: input.x, clientY: input.y, dataTransfer }))
    canvas.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, clientX: input.x, clientY: input.y, dataTransfer }))
  }, { kind, definitionId, ...point })
}

async function connect(page: Page, source: Locator, target: Locator): Promise<void> {
  const start = await waitForBoundingBox(source)
  const end = await waitForBoundingBox(target)
  await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2)
  await page.mouse.down()
  await page.mouse.move(end.x + end.width / 2, end.y + end.height / 2, { steps: 8 })
  await page.mouse.up()
}

async function createDefinition(page: Page, kind: 'module' | 'function', name: string) {
  await page.getByRole('button', { name: `+ New ${kind}`, exact: true }).click()
  const dialog = page.getByRole('form', { name: `Create ${kind}` })
  await dialog.getByLabel(`${kind === 'module' ? 'Module' : 'Function'} name`).fill(name)
  await dialog.getByRole('button', { name: 'Create', exact: true }).click()
  const frame = page.locator('node-editor .definition-frame').filter({ hasText: name })
  const definitionId = await frame.getAttribute('data-definition-id')
  if (!definitionId) throw new Error(`Expected ${kind} definition id`)
  const roles = await page.locator('node-editor').evaluate((element, id) => {
    const editor = (element as unknown as { getEditorInstance(): { getDefinitions(): { id: string; inputsNodeId: string; outputNodeId: string }[] } }).getEditorInstance()
    const definition = editor.getDefinitions().find((item) => item.id === id)
    return definition ? { inputs: definition.inputsNodeId, output: definition.outputNodeId } : null
  }, definitionId)
  if (!roles) throw new Error(`Expected ${kind} interface nodes`)
  return {
    definitionId,
    frame,
    inputs: page.locator(`node-editor .node[data-node-id="${roles.inputs}"]`),
    output: page.locator(`node-editor .node[data-node-id="${roles.output}"]`),
  }
}

async function addNumberParameter(inputs: Locator, name: string): Promise<void> {
  await inputs.locator('.node-add-summary').click()
  await inputs.getByRole('button', { name: 'Parameter', exact: true }).click()
  const form = inputs.locator('.node-parameter-popover')
  await form.getByLabel('Name', { exact: true }).fill(name)
  await form.getByRole('button', { name: 'Add', exact: true }).click()
}

async function expectDirection(socket: Locator, side: 'input' | 'output'): Promise<void> {
  await expect(socket).toHaveAttribute('data-connector-shape', side === 'input' ? 'input-notch' : 'output-arrow')
  await expect(socket).toHaveAttribute('aria-description', side === 'input' ? 'Connection target' : 'Connection source')
  await expect(socket).toHaveAttribute('role', 'button')
  await expect(socket).toHaveAttribute('tabindex', '0')
  const bounds = await waitForBoundingBox(socket)
  expect(bounds.width).toBe(10)
  expect(bounds.height).toBe(10)
}

test('ordinary connectors keep typed colour and compact directional shapes across dynamic and scoped nodes', async ({ page }) => {
  test.setTimeout(60_000)
  await ready(page)
  const editor = page.locator('node-editor')
  const canvas = await waitForBoundingBox(editor)

  await dropPaletteNode(page, 'number', { x: canvas.x + 80, y: canvas.y + 80 })
  await dropPaletteNode(page, 'vector3', { x: canvas.x + 300, y: canvas.y + 70 })
  await dropPaletteNode(page, 'boolean', { x: canvas.x + 520, y: canvas.y + 80 })
  await dropPaletteNode(page, 'cube', { x: canvas.x + 80, y: canvas.y + 310 })
  await dropPaletteNode(page, 'union', { x: canvas.x + 310, y: canvas.y + 300 })
  await dropPaletteNode(page, 'conditional', { x: canvas.x + 530, y: canvas.y + 300 })
  await dropPaletteNode(page, 'for', { x: canvas.x + 760, y: canvas.y + 80 })

  const mainNumberId = await editor.locator('.node[data-node-type="number"]').getAttribute('data-node-id')
  if (!mainNumberId) throw new Error('Expected Main Number node id')
  const number = editor.locator(`.node[data-node-id="${mainNumberId}"]`)
  const vector = editor.locator('.node[data-node-type="vector3"]')
  const boolean = editor.locator('.node[data-node-type="boolean"]')
  const cube = editor.locator('.node[data-node-type="cube"]')
  const union = editor.locator('.node[data-node-type="union"]')
  const conditional = editor.locator('.node[data-node-type="conditional"]')
  const forHeader = editor.locator('.node[data-node-type="for"]')
  const forResult = editor.locator('.node[data-node-type="for-result"]')

  const representatives = [
    [number.locator('[data-param-key="value"] .node-socket'), 'input', 'rgb(242, 184, 75)'],
    [number.locator('.node-port--output .node-socket'), 'output', 'rgb(242, 184, 75)'],
    [vector.locator('[data-param-key="value"] .node-socket'), 'input', 'rgb(176, 124, 255)'],
    [vector.locator('.node-port--output .node-socket'), 'output', 'rgb(176, 124, 255)'],
    [boolean.locator('[data-param-key="value"] .node-socket'), 'input', 'rgb(99, 193, 116)'],
    [cube.locator('.node-port--output .node-socket'), 'output', 'rgb(122, 192, 255)'],
    [union.locator('.node-socket[data-socket-side="input"]'), 'input', 'rgb(122, 192, 255)'],
    [forHeader.locator('[data-param-key="start"] .node-socket'), 'input', 'rgb(242, 184, 75)'],
    [forHeader.locator('.node-socket[data-socket-key="value"]'), 'output', 'rgb(242, 184, 75)'],
    [forResult.locator('.node-socket[data-socket-key^="child:"]').first(), 'input', 'rgb(122, 192, 255)'],
    [forResult.locator('.node-socket[data-socket-key="geometry"]'), 'output', 'rgb(122, 192, 255)'],
  ] as const
  for (const [socket, side, colour] of representatives) {
    await expectDirection(socket, side)
    expect(await socket.evaluate((element) => getComputedStyle(element, '::after').backgroundColor)).toBe(colour)
  }

  const unresolved = conditional.locator('.node-socket[data-socket-key="result"]')
  await expectDirection(unresolved, 'output')
  await expect(unresolved).toHaveAttribute('aria-disabled', 'true')
  expect(await unresolved.evaluate((element) => getComputedStyle(element, '::after').backgroundColor)).toBe('rgb(136, 136, 136)')
  await unresolved.dispatchEvent('pointerdown', { button: 0, buttons: 1, pointerId: 81, pointerType: 'mouse' })
  await expect(editor.locator('svg.connection[data-real-connection="false"]')).toHaveCount(0)
  await expect(unresolved).toHaveAttribute('aria-pressed', 'false')

  const structuralAnchors = editor.locator('.node-structural-anchor')
  await expect(structuralAnchors).toHaveCount(2)
  for (const anchor of [structuralAnchors.nth(0), structuralAnchors.nth(1)]) {
    await expect(anchor).not.toHaveAttribute('data-connector-shape', /.+/)
    await expect(anchor).not.toHaveAttribute('tabindex', /.+/)
    await expect(anchor).toHaveAttribute('role', 'img')
    await expect(anchor).toHaveCSS('pointer-events', 'none')
  }

  const cubeOutput = cube.locator('.node-port--output .node-socket')
  const unionInput = union.locator('.node-socket[data-socket-side="input"]').first()
  await connect(page, cubeOutput, unionInput)
  await expect(cubeOutput).toHaveAttribute('data-connected', 'true')
  await expect(unionInput).toHaveAttribute('data-connected', 'true')
  await expect(union.locator('.node-socket[data-socket-side="input"]')).toHaveCount(2)
  await expect(union.locator('.node-socket[data-socket-side="input"]').nth(1)).toHaveAttribute('data-connector-shape', 'input-notch')

  await cube.locator('.node-header').click({ position: { x: 20, y: 12 } })
  await cubeOutput.hover()
  await expect(cubeOutput).toHaveAttribute('data-connector-shape', 'output-arrow')
  expect(await cubeOutput.evaluate((element) => getComputedStyle(element).filter)).not.toBe('none')
  await cubeOutput.focus()
  await expect(cubeOutput).toBeFocused()
  await expect(cubeOutput).toHaveCSS('outline-style', 'solid')

  const moduleDefinition = await createDefinition(page, 'module', 'direction_module')
  await addNumberParameter(moduleDefinition.inputs, 'width')
  await moduleDefinition.inputs.locator('.node-add-summary').click()
  await moduleDefinition.inputs.getByRole('button', { name: 'Geometry input', exact: true }).click()
  const geometryInput = moduleDefinition.inputs.getByRole('group', { name: 'Geometry input', exact: true })
  await geometryInput.getByLabel('Geometry input name').fill('Child')
  await geometryInput.getByRole('button', { name: 'Add', exact: true }).click()
  await expectDirection(moduleDefinition.inputs.locator('.node-socket[data-socket-key^="parameter:"]'), 'output')
  await expectDirection(moduleDefinition.inputs.locator('.node-socket[data-socket-key^="geometry:"]').last(), 'output')
  await expectDirection(moduleDefinition.output.locator('.node-socket[data-socket-key="geometry"]'), 'input')

  await dropDefinitionCall(page, 'module', moduleDefinition.definitionId, { x: canvas.x + 650, y: canvas.y + 430 })
  const moduleCall = editor.locator('.node[data-node-type="module-call"]')
  await expectDirection(moduleCall.locator('.node-socket[data-socket-key^="parameter:"]'), 'input')
  await expectDirection(moduleCall.locator('.node-socket[data-socket-key^="geometry:"]').last(), 'input')
  await expectDirection(moduleCall.locator('.node-socket[data-socket-key="geometry"]'), 'output')

  const functionDefinition = await createDefinition(page, 'function', 'direction_function')
  await addNumberParameter(functionDefinition.inputs, 'amount')
  await expectDirection(functionDefinition.inputs.locator('.node-socket[data-socket-key^="parameter:"]'), 'output')
  await expectDirection(functionDefinition.output.locator('.node-socket[data-socket-key="result"]'), 'input')
  const functionFrame = await waitForBoundingBox(functionDefinition.frame)
  await dropPaletteNode(page, 'number', { x: functionFrame.x + functionFrame.width / 2, y: functionFrame.y + functionFrame.height / 2 })
  const functionNumberId = await editor.evaluate((element, definitionId) => {
    const instance = (element as unknown as { getEditorInstance(): { getNodeScope(id: string): string | null } }).getEditorInstance()
    return [...element.shadowRoot!.querySelectorAll<HTMLElement>('.node[data-node-type="number"]')]
      .map((node) => node.dataset.nodeId!)
      .find((id) => instance.getNodeScope(id) === definitionId)
  }, functionDefinition.definitionId)
  if (!functionNumberId) throw new Error('Expected Number in Function scope')
  const functionNumber = editor.locator(`.node[data-node-id="${functionNumberId}"]`)
  await connect(page, functionNumber.locator('.node-port--output .node-socket'), functionDefinition.output.locator('.node-socket[data-socket-key="result"]'))
  await dropDefinitionCall(page, 'function', functionDefinition.definitionId, { x: canvas.x + 480, y: canvas.y + 430 })
  const functionCall = editor.locator('.node[data-node-type="function-call"]')
  await expectDirection(functionCall.locator('.node-socket[data-socket-key^="parameter:"]'), 'input')
  await expectDirection(functionCall.locator('.node-socket[data-socket-key="value"]'), 'output')

  await number.locator('.node-more-summary').click()
  await number.getByRole('menuitem', { name: 'Rename', exact: true }).click()
  await number.locator('input.node-title').fill('direction_value')
  await number.locator('input.node-title').press('Enter')
  await number.getByRole('button', { name: 'Create variable reference', exact: true }).click()
  await page.mouse.click(canvas.x + canvas.width - 60, canvas.y + canvas.height - 60)
  await expectDirection(editor.locator('.node[data-node-type="variable-reference"] .node-socket'), 'output')
})

test('only outputs start pointer, touch, and keyboard wires while rewire and removal stay explicit', async ({ page }) => {
  await ready(page)
  const editor = page.locator('node-editor')
  const canvas = await waitForBoundingBox(editor)
  await dropPaletteNode(page, 'number', { x: canvas.x + 90, y: canvas.y + 90 })
  await dropPaletteNode(page, 'number', { x: canvas.x + 90, y: canvas.y + 280 })
  await dropPaletteNode(page, 'arithmetic', { x: canvas.x + 430, y: canvas.y + 120 })
  const numberIds = await editor.locator('.node[data-node-type="number"]').evaluateAll((nodes) => nodes.map((node) => (node as HTMLElement).dataset.nodeId!))
  const firstNumber = editor.locator(`.node[data-node-id="${numberIds[0]}"]`)
  const secondNumber = editor.locator(`.node[data-node-id="${numberIds[1]}"]`)
  const arithmetic = editor.locator('.node[data-node-type="arithmetic"]')
  const firstOutput = firstNumber.locator('.node-socket[data-socket-side="output"]')
  const secondOutput = secondNumber.locator('.node-socket[data-socket-side="output"]')
  const inputA = arithmetic.locator('.node-socket[data-socket-key="a"]')
  const inputB = arithmetic.locator('.node-socket[data-socket-key="b"]')
  const draft = editor.locator('svg.connection[data-real-connection="false"]')
  const real = editor.locator('svg.connection[data-real-connection="true"]')

  const inputBox = await waitForBoundingBox(inputA)
  await page.mouse.move(inputBox.x + inputBox.width / 2, inputBox.y + inputBox.height / 2)
  await page.mouse.down()
  await page.mouse.move(inputBox.x - 80, inputBox.y + 40, { steps: 6 })
  await expect(draft).toHaveCount(0)
  await page.mouse.up()
  await expect(real).toHaveCount(0)
  await expect(editor.locator('#canvas')).not.toHaveClass(/connection-gesture--active/)

  await inputA.dispatchEvent('pointerdown', { pointerId: 71, pointerType: 'touch', button: 0, buttons: 1, clientX: inputBox.x + 5, clientY: inputBox.y + 5 })
  await inputA.dispatchEvent('pointermove', { pointerId: 71, pointerType: 'touch', buttons: 1, clientX: inputBox.x - 60, clientY: inputBox.y + 35 })
  await inputA.dispatchEvent('pointerup', { pointerId: 71, pointerType: 'touch', button: 0, buttons: 0, clientX: inputBox.x - 60, clientY: inputBox.y + 35 })
  await expect(draft).toHaveCount(0)
  await expect(real).toHaveCount(0)

  await inputA.focus()
  await page.keyboard.press('Enter')
  await page.keyboard.press('Space')
  await expect(inputA).toBeFocused()
  await expect(draft).toHaveCount(0)
  await expect(editor.locator('#canvas')).not.toHaveClass(/connection-gesture--active/)

  await connect(page, firstOutput, inputA)
  await expect(real).toHaveCount(1)
  await expect(firstOutput).toHaveAttribute('data-connected', 'true')
  await expect(inputA).toHaveAttribute('data-connected', 'true')

  await inputA.click()
  await expect(draft).toHaveCount(0)
  await expect(real).toHaveCount(1)
  await inputA.focus()
  await page.keyboard.press('Enter')
  await expect(real).toHaveCount(1)

  await connect(page, secondOutput, inputA)
  await expect(real).toHaveCount(1)
  const secondNodeId = numberIds[1]
  await expect.poll(() => editor.evaluate((element) => {
    const instance = (element as unknown as { getEditorInstance(): { editor: { getConnections(): { source: string; targetInput: string }[] } } }).getEditorInstance()
    return instance.editor.getConnections().find((connection) => connection.targetInput === 'a')?.source
  })).toBe(secondNodeId)

  await firstOutput.focus()
  await page.keyboard.press('Enter')
  await expect(firstOutput).toHaveAttribute('aria-pressed', 'true')
  await expect(draft).toHaveCount(1)
  await inputB.focus()
  await page.keyboard.press('Enter')
  await waitForUiCommit(page)
  await expect(real).toHaveCount(2)
  await expect(draft).toHaveCount(0)

  const selectedWire = real.first().locator('.connection-hit-path')
  await selectedWire.dispatchEvent('pointerdown', { button: 0 })
  await expect(editor.locator('.connection--selected')).toHaveCount(1)
  await page.keyboard.press('Delete')
  await expect(real).toHaveCount(1)
})

import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test, type Locator, type Page } from '@playwright/test'

const ROOT = fileURLToPath(new URL('..', import.meta.url))

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
  await page.getByRole('button', { name: 'Cube', exact: true }).click()
  const node = page.locator('node-editor .node').filter({ has: page.locator('.node-title', { hasText: 'Cube' }) })
  await expect(node).toHaveCount(1)
  await node.locator('.node-pin').click()
  await node.getByText('+ Size', { exact: true }).click()
  await node.getByRole('button', { name: 'XYZ', exact: true }).click()
  await node.locator('[data-param-key="sizeX"] input').fill(size)
  await expect(page.locator('scadlet-app .dirty-indicator')).toBeHidden({ timeout: 5_000 })
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

test('Cube Size add menu exposes one selected representation at a time', async ({ page }) => {
  await waitForLocalLibrary(page)
  await page.getByRole('button', { name: 'Cube', exact: true }).click()
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
  await page.getByRole('button', { name: 'Translate', exact: true }).click()
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

  await page.getByRole('button', { name: 'Cube', exact: true }).click()
  const cube = page.locator('node-editor .node').filter({ has: page.locator('.node-title', { hasText: 'Cube' }) })
  await cube.locator('.node-pin').click()
  await cube.getByRole('button', { name: '+ Center', exact: true }).click()
  await expect(cube.locator('[data-param-key="center"] input[type="checkbox"]')).toHaveCount(1)
  await expect(cube.locator('[data-param-key="center"] .node-socket[data-socket-type="boolean"]')).toHaveCount(1)
})

test('variadic Boolean nodes use compact localized child affordances', async ({ page }) => {
  await waitForLocalLibrary(page)
  await page.getByRole('button', { name: 'Union', exact: true }).click()
  const union = page.locator('node-editor .node').filter({ has: page.locator('.node-title', { hasText: 'Union' }) })
  await expect(union.locator('.node-port-label')).toHaveText('+')
  await expect(union.locator('.node-socket[aria-label="Add geometry child"]')).toHaveCount(1)
  await expect(union.getByText('Geometry child', { exact: true })).toHaveCount(0)

  await page.getByRole('button', { name: 'Intersection', exact: true }).click()
  const intersection = page.locator('node-editor .node').filter({ has: page.locator('.node-title', { hasText: 'Intersection' }) })
  await expect(intersection.locator('.node-port-label')).toHaveText('+')
  await expect(intersection.locator('.node-socket[aria-label="Add geometry child"]')).toHaveCount(1)
})

test('typed value nodes remain compact and a Number drives Cube Size', async ({ page }) => {
  await waitForLocalLibrary(page)
  await page.getByRole('button', { name: 'Number', exact: true }).click()
  await page.getByRole('button', { name: 'Cube', exact: true }).click()
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
  await page.getByRole('button', { name: 'Number', exact: true }).click()
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

  await page.getByRole('button', { name: 'Add', exact: true }).click()
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
  await page.getByRole('button', { name: 'Cube', exact: true }).click()
  const cube = page.locator('node-editor .node').filter({ has: page.locator('.node-title', { hasText: 'Cube' }) })
  const cubeHeader = await cube.locator('.node-header').boundingBox()
  if (!cubeHeader) throw new Error('Expected Cube node header')
  await page.mouse.move(cubeHeader.x + 20, cubeHeader.y + cubeHeader.height / 2)
  await page.mouse.down()
  await page.mouse.move(cubeHeader.x - 180, cubeHeader.y + cubeHeader.height / 2, { steps: 6 })
  await page.mouse.up()
  await page.getByRole('button', { name: 'Sphere', exact: true }).click()

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
  await page.getByRole('button', { name: 'Boolean', exact: true }).click()
  await page.getByRole('button', { name: 'Vector3', exact: true }).click()
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
  await page.getByRole('button', { name: 'Add', exact: true }).click()
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

  await page.getByRole('button', { name: 'Number', exact: true }).click()
  await page.getByRole('button', { name: 'Cube', exact: true }).click()
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
  await page.getByRole('button', { name: 'Cube', exact: true }).click()
  const cubes = page.locator('node-editor .node').filter({ has: page.locator('.node-title', { hasText: 'Cube' }) })
  const cubeA = cubes.nth(0)
  await configureScalarCube(cubeA)
  await moveNode(cubeA, 140, -90)
  await page.getByRole('button', { name: 'Cube', exact: true }).click()
  const cubeB = cubes.nth(1)
  await configureScalarCube(cubeB)
  await moveNode(cubeB, 160, 110)

  await page.getByRole('button', { name: 'Number', exact: true }).click()
  const number = page.locator('node-editor .node').filter({ has: page.locator('.node-header input.node-title') })

  const source = await number.locator('.node-port--output .node-socket').boundingBox()
  const headerA = await cubeA.locator('.node-header').boundingBox()
  const headerB = await cubeB.locator('.node-header').boundingBox()
  if (!source || !headerA || !headerB) throw new Error('Expected Number output and Cube headers')
  const sourceCenter = { x: source.x + source.width / 2, y: source.y + source.height / 2 }

  // Drag mode: reveal A, move directly to B (which clears A), then cancel.
  await page.mouse.move(sourceCenter.x, sourceCenter.y)
  await page.mouse.down()
  await page.mouse.move(headerA.x + 20, headerA.y + headerA.height / 2, { steps: 8 })
  await expect(cubeA.locator('[data-param-key="size"]')).toBeVisible()
  await page.mouse.move(headerB.x + 20, headerB.y + headerB.height / 2, { steps: 8 })
  await expect(cubeA.locator('[data-param-key="size"]')).toBeHidden()
  await expect(cubeB.locator('[data-param-key="size"]')).toBeVisible()
  await page.mouse.up()
  await page.mouse.move(5, 200)
  await expect(cubeB.locator('[data-param-key="size"]')).toBeHidden({ timeout: 2_000 })

  // Click mode keeps the same gesture active after release. A second click
  // on the real input completes it; the row then remains for the real graph
  // connection rather than for the temporary disclosure state.
  await page.mouse.click(sourceCenter.x, sourceCenter.y)
  await page.mouse.move(headerB.x + 20, headerB.y + headerB.height / 2, { steps: 8 })
  await expect(cubeB.locator('[data-param-key="size"]')).toBeVisible()
  const target = await cubeB.locator('[data-param-key="size"] .node-socket').boundingBox()
  if (!target) throw new Error('Expected disclosed Cube Size socket')
  await page.mouse.click(target.x + target.width / 2, target.y + target.height / 2)
  await expect(cubeB.locator('[data-param-key="size"] input')).toBeDisabled()
  await page.mouse.move(5, 200)
  await expect(cubeB.locator('[data-param-key="size"]')).toBeVisible()

  // A Vector3-only Cube representation is incompatible with this Number
  // wire and must not be exposed as a false target.
  await page.getByRole('button', { name: 'Cube', exact: true }).click()
  const cube = cubes.nth(2)
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
    await page.getByRole('button', { name: 'Number', exact: true }).click()
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

  await page.getByRole('button', { name: 'Translate', exact: true }).click()
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
  await page.getByRole('button', { name: 'Number', exact: true }).click()
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

  await page.getByRole('button', { name: 'Add', exact: true }).click()
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
    await page.getByRole('button', { name: 'Number', exact: true }).click()
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

  await page.getByRole('button', { name: 'Vector3', exact: true }).click()
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

  await page.getByRole('button', { name: 'Cube', exact: true }).click()
  const cube = page.locator('node-editor .node').filter({ has: page.locator('.node-title', { hasText: 'Cube' }) })
  await cube.locator('.node-pin').click()
  await cube.getByText('+ Size', { exact: true }).click()
  await cube.getByRole('button', { name: 'XYZ', exact: true }).click()
  await cube.locator('.node-pin').click()
  await moveNode(cube, 190, 210)
  await cube.locator('.node-pin').click()
  await page.getByRole('button', { name: 'Number', exact: true }).click()
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
  await second.getByRole('button', { name: 'Sphere', exact: true }).click()
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

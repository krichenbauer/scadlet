import { expect, test, type Page } from '@playwright/test'

async function waitForLocalLibrary(page: Page): Promise<void> {
  await page.goto('/')
  await expect(page.locator('scadlet-app .project-name')).toBeEnabled()
}

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    Object.defineProperty(window, 'showOpenFilePicker', { value: undefined, configurable: true })
    Object.defineProperty(window, 'showSaveFilePicker', { value: undefined, configurable: true })
  })
})

test('every ordinary palette node exposes the shared accessible tooltip', async ({ page }) => {
  await waitForLocalLibrary(page)
  const palette = page.locator('node-palette')
  const entries = palette.locator('.node-item[data-node-type]')
  await expect(entries).toHaveCount(20)

  expect(await entries.evaluateAll((items) => items.map((item) => item.getAttribute('data-node-type')))).toEqual([
    'cube', 'cylinder', 'sphere',
    'translate', 'rotate', 'scale',
    'difference', 'union', 'intersection',
    'if',
    'scad-settings',
    'number', 'boolean', 'vector3',
    'arithmetic', 'trigonometry', 'basic-math', 'exponential-log', 'compare', 'conditional',
  ])
  for (const entry of await entries.all()) {
    await expect(entry).toHaveAttribute('tabindex', '0')
    await expect(entry).toHaveAttribute('aria-describedby', 'node-palette-tooltip')
  }
  for (const select of await palette.locator('.node-item--operation select').all()) {
    await expect(select).toHaveAttribute('aria-describedby', 'node-palette-tooltip')
  }

  const tooltip = palette.locator('#node-palette-tooltip')
  await expect(tooltip).toHaveCount(1)
  await expect(tooltip).toHaveAttribute('role', 'tooltip')
  await expect(tooltip).toHaveAttribute('popover', 'manual')
  await expect(tooltip).toBeHidden()
})

test('hover and keyboard focus show the same English explanation and cleanly dismiss it', async ({ page }) => {
  await waitForLocalLibrary(page)
  const palette = page.locator('node-palette')
  const cube = palette.locator('.node-item[data-node-type="cube"]')
  const tooltip = palette.locator('#node-palette-tooltip')
  const expected = 'Creates a cuboid. Its size and centering can be set through inputs.'

  await cube.hover()
  expect(await tooltip.evaluate((element) => element.matches(':popover-open'))).toBe(false)
  await expect(tooltip).toBeVisible({ timeout: 1_200 })
  await expect(tooltip.locator('.palette-tooltip-title')).toHaveText('Cube')
  await expect(tooltip.locator('.palette-tooltip-description')).toHaveText(expected)
  await expect(cube).toHaveAccessibleDescription(new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))

  const [normalIconSize, tooltipIconSize] = await Promise.all([
    cube.locator('.node-item-icon').evaluate((icon) => ({ width: getComputedStyle(icon).width, height: getComputedStyle(icon).height })),
    tooltip.locator('.palette-tooltip-icon').evaluate((icon) => ({ width: getComputedStyle(icon).width, height: getComputedStyle(icon).height })),
  ])
  expect(normalIconSize).toEqual({ width: '18px', height: '18px' })
  expect(tooltipIconSize).toEqual({ width: '44px', height: '44px' })
  await expect(tooltip).toHaveCSS('pointer-events', 'none')
  await page.screenshot({ path: 'test-results/palette-tooltip-cube.png' })

  await page.locator('node-editor').hover({ position: { x: 100, y: 100 } })
  await expect(tooltip).toBeHidden()

  await cube.focus()
  await expect(cube).toBeFocused()
  await expect(tooltip).toBeVisible()
  await expect(tooltip.locator('.palette-tooltip-description')).toHaveText(expected)
  await page.keyboard.press('Escape')
  await expect(tooltip).toBeHidden()
  await expect(cube).toBeFocused()

  await page.locator('scadlet-app .project-name').focus()
  await cube.focus()
  await expect(tooltip).toBeVisible()
  const dragPayload = await cube.evaluate((item) => {
    const transfer = new DataTransfer()
    item.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: transfer }))
    return transfer.getData('application/x-scadlet-node-type')
  })
  expect(dragPayload).toBe('cube')
  await expect(tooltip).toBeHidden()
})

test('Math copy names its operations and an edge tooltip stays inside the viewport, outside the palette clip', async ({ page }) => {
  await waitForLocalLibrary(page)
  const palette = page.locator('node-palette')
  const trigonometry = palette.locator('.node-item[data-node-type="trigonometry"]')
  const edgeEntry = palette.locator('.node-item[data-node-type="exponential-log"]')
  const tooltip = palette.locator('#node-palette-tooltip')

  await trigonometry.scrollIntoViewIfNeeded()
  await trigonometry.focus()
  await expect(tooltip).toBeVisible()
  await expect(tooltip.locator('.palette-tooltip-description')).toHaveText('Includes sin, cos, tan, asin, acos, atan, and atan2.')

  await page.locator('scadlet-app .project-name').focus()
  await edgeEntry.scrollIntoViewIfNeeded()
  await edgeEntry.hover()
  await expect(tooltip).toBeVisible({ timeout: 1_200 })
  await expect(tooltip.locator('.palette-tooltip-description')).toHaveText('Includes exp, ln, and log.')

  const paletteBox = await palette.boundingBox()
  const tooltipBox = await tooltip.boundingBox()
  const viewport = page.viewportSize()
  if (!paletteBox || !tooltipBox || !viewport) throw new Error('Expected palette, tooltip, and viewport bounds')
  expect(tooltipBox.x).toBeGreaterThanOrEqual(paletteBox.x + paletteBox.width)
  expect(tooltipBox.x).toBeGreaterThanOrEqual(8)
  expect(tooltipBox.y).toBeGreaterThanOrEqual(8)
  expect(tooltipBox.x + tooltipBox.width).toBeLessThanOrEqual(viewport.width - 8)
  expect(tooltipBox.y + tooltipBox.height).toBeLessThanOrEqual(viewport.height - 8)

  await page.screenshot({ path: 'test-results/palette-tooltip-edge.png' })
})

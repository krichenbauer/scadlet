import { expect, test, type Locator, type Page } from '@playwright/test'

interface RenderCall {
  source: string
  timeoutMs: number | null
}

async function waitUntilReady(page: Page): Promise<void> {
  await page.goto('/')
  await expect(page.getByRole('textbox', { name: 'Project name' })).toBeEnabled()
}

async function waitForExecutionIdle(page: Page): Promise<void> {
  await expect.poll(() => page.locator('scadlet-app').evaluate(
    (element) => !(element as unknown as { rendering: boolean }).rendering,
  ), { timeout: 20_000 }).toBe(true)
}

async function dropNode(page: Page, type: string, offset: { x: number; y: number }): Promise<void> {
  await page.evaluate(({ type, offset }) => {
    const editor = document.querySelector('scadlet-app')?.shadowRoot?.querySelector('node-editor')
    const canvas = editor?.shadowRoot?.querySelector('#canvas')
    if (!canvas) throw new Error('Expected node editor canvas')
    const bounds = canvas.getBoundingClientRect()
    const dataTransfer = new DataTransfer()
    dataTransfer.setData('application/x-scadlet-node-type', type)
    for (const eventType of ['dragover', 'drop']) {
      canvas.dispatchEvent(new DragEvent(eventType, {
        bubbles: true,
        cancelable: true,
        clientX: bounds.left + offset.x,
        clientY: bounds.top + offset.y,
        dataTransfer,
      }))
    }
  }, { type, offset })
}

async function node(page: Page, title: string): Promise<Locator> {
  const result = page.locator('node-editor .node').filter({ has: page.locator('.node-title', { hasText: title }) })
  await expect(result).toHaveCount(1)
  return result
}

async function installRenderTrace(page: Page): Promise<void> {
  await page.locator('scadlet-app').evaluate((element) => {
    const app = element as unknown as {
      dataset: DOMStringMap
      renderController: {
        render(source: string, execution?: { timeoutMs?: number }): Promise<unknown>
      }
    }
    const render = app.renderController.render.bind(app.renderController)
    app.dataset.renderCalls = '[]'
    app.renderController.render = (source, execution) => {
      const calls = JSON.parse(app.dataset.renderCalls ?? '[]') as RenderCall[]
      calls.push({ source, timeoutMs: execution?.timeoutMs ?? null })
      app.dataset.renderCalls = JSON.stringify(calls)
      return render(source, execution)
    }
  })
}

async function renderCalls(page: Page): Promise<RenderCall[]> {
  return page.locator('scadlet-app').evaluate((element) =>
    JSON.parse((element as HTMLElement).dataset.renderCalls ?? '[]') as RenderCall[],
  )
}

async function clearPreviewCache(page: Page): Promise<void> {
  await page.locator('scadlet-app').evaluate((element) => {
    (element as unknown as { previewCache: { clear(): void } }).previewCache.clear()
  })
}

async function dismissInspectOnCanvas(page: Page): Promise<void> {
  const canvas = await page.locator('node-editor').boundingBox()
  if (!canvas) throw new Error('Expected editor bounds')
  await page.mouse.click(canvas.x + canvas.width - 20, canvas.y + canvas.height - 20)
  await expect(page.locator('node-editor .node--inspected')).toHaveCount(0)
}

async function deleteNode(page: Page, target: Locator): Promise<void> {
  await target.locator('.node-more-summary').click()
  await target.getByRole('menuitem', { name: 'Delete' }).click()
  await expect(target).toHaveCount(0)
}

test('automatic Preview uses cache while manual Render bypasses and refreshes it', async ({ page }) => {
  await waitUntilReady(page)
  await installRenderTrace(page)
  await dropNode(page, 'cube', { x: 120, y: 120 })
  const cube = await node(page, 'Cube')
  await expect.poll(async () => (await renderCalls(page)).length, { timeout: 20_000 }).toBe(1)
  await waitForExecutionIdle(page)
  expect((await renderCalls(page))[0]?.timeoutMs).toBe(15_000)

  // Remove the automatic result so only the following manual success can
  // populate the cache used after Inspect dismissal.
  await clearPreviewCache(page)
  await page.getByRole('button', { name: 'Render', exact: true }).click()
  await expect.poll(async () => (await renderCalls(page)).length).toBe(2)
  await waitForExecutionIdle(page)
  expect((await renderCalls(page))[1]?.timeoutMs).toBeNull()

  // Inspect has identical SCAD but must bypass the main-preview cache.
  await cube.locator('.node-title').dblclick()
  await expect(cube).toHaveClass(/node--inspected/)
  await expect.poll(async () => (await renderCalls(page)).length).toBe(3)
  await waitForExecutionIdle(page)
  expect((await renderCalls(page))[2]?.timeoutMs).toBeNull()

  await dismissInspectOnCanvas(page)
  await waitForExecutionIdle(page)
  await page.waitForTimeout(500)
  expect(await renderCalls(page)).toHaveLength(3)
  await expect(page.locator('scadlet-app .scad-output')).toContainText('cube(')
})

test('out-of-scope Inspect output is never admitted to or read from the main cache', async ({ page }) => {
  await waitUntilReady(page)
  await dropNode(page, 'cube', { x: 100, y: 100 })
  await dropNode(page, 'sphere', { x: 380, y: 100 })
  const cube = await node(page, 'Cube')
  const sphere = await node(page, 'Sphere')
  await expect(page.locator('scadlet-app .scad-output')).toContainText('sphere(', { timeout: 20_000 })
  await waitForExecutionIdle(page)
  await clearPreviewCache(page)
  await installRenderTrace(page)

  await cube.locator('.node-title').dblclick()
  await expect(cube).toHaveClass(/node--inspected/)
  await waitForExecutionIdle(page)
  expect(await renderCalls(page)).toHaveLength(1)

  // Sphere is outside Cube's Inspect scope, so this restores the two-node main graph.
  await sphere.locator('.node-header').click({ position: { x: 20, y: 12 } })
  await expect.poll(async () => (await renderCalls(page)).length, { timeout: 20_000 }).toBe(2)
  await waitForExecutionIdle(page)

  // The resulting main source now equals the earlier Cube Inspect source. It
  // must execute because that Inspect result was never cached as main output.
  await deleteNode(page, sphere)
  await expect.poll(async () => (await renderCalls(page)).length, { timeout: 20_000 }).toBe(3)
  await waitForExecutionIdle(page)
  expect((await renderCalls(page))[2]?.source).toContain('cube(')
  expect((await renderCalls(page))[2]?.source).not.toContain('sphere(')
})

test('a failed manual Render does not refresh the automatic-preview cache', async ({ page }) => {
  await waitUntilReady(page)
  await dropNode(page, 'cube', { x: 100, y: 100 })
  const cube = await node(page, 'Cube')
  await expect(page.locator('scadlet-app .scad-output')).toContainText('cube(', { timeout: 20_000 })
  await waitForExecutionIdle(page)
  await clearPreviewCache(page)

  // Fail one manual call. Returning no result means there is nothing valid to admit.
  await page.locator('scadlet-app').evaluate((element) => {
    const app = element as unknown as {
      dataset: DOMStringMap
      renderController: { render(source: string, execution?: { timeoutMs?: number }): Promise<unknown> }
    }
    const render = app.renderController.render.bind(app.renderController)
    app.dataset.renderCalls = '[]'
    let failNext = true
    app.renderController.render = (source, execution) => {
      const calls = JSON.parse(app.dataset.renderCalls ?? '[]') as RenderCall[]
      calls.push({ source, timeoutMs: execution?.timeoutMs ?? null })
      app.dataset.renderCalls = JSON.stringify(calls)
      if (failNext) {
        failNext = false
        return Promise.reject(new Error('simulated render failure'))
      }
      return render(source, execution)
    }
  })
  await page.getByRole('button', { name: 'Render', exact: true }).click()
  await expect(page.getByText('simulated render failure')).toBeVisible()
  expect(await renderCalls(page)).toHaveLength(1)

  // Render another source, then return to Cube. The failed Cube result cannot
  // satisfy this automatic request.
  await dropNode(page, 'sphere', { x: 380, y: 100 })
  const sphere = await node(page, 'Sphere')
  await expect.poll(async () => (await renderCalls(page)).length, { timeout: 20_000 }).toBe(2)
  await waitForExecutionIdle(page)
  await deleteNode(page, sphere)
  await expect.poll(async () => (await renderCalls(page)).length, { timeout: 20_000 }).toBe(3)
  await waitForExecutionIdle(page)
  expect((await renderCalls(page))[2]?.source).toContain('cube(')
})

test('a cancelled stale automatic result cannot seed the cache or consume the replacement budget', async ({ page }) => {
  await waitUntilReady(page)
  await dropNode(page, 'cube', { x: 100, y: 100 })
  const cube = await node(page, 'Cube')
  await expect(page.locator('scadlet-app .scad-output')).toContainText('cube(', { timeout: 20_000 })
  await waitForExecutionIdle(page)
  // A delayed obsolete result is cancelled by the next revision and cannot
  // become the cache entry used when that exact source returns later.
  await clearPreviewCache(page)
  await page.locator('scadlet-app').evaluate((element) => {
    const app = element as unknown as {
      dataset: DOMStringMap
      renderController: { render(source: string, execution?: { timeoutMs?: number }): Promise<unknown> }
    }
    const render = app.renderController.render.bind(app.renderController)
    app.dataset.renderCalls = '[]'
    let delayNext = true
    app.renderController.render = (source, execution) => {
      const calls = JSON.parse(app.dataset.renderCalls ?? '[]') as RenderCall[]
      calls.push({ source, timeoutMs: execution?.timeoutMs ?? null })
      app.dataset.renderCalls = JSON.stringify(calls)
      if (delayNext) {
        delayNext = false
        return new Promise((resolve) => {
          ;(window as unknown as { resolveStaleRender(): void }).resolveStaleRender = () => resolve({ kind: 'empty' })
        })
      }
      return render(source, execution)
    }
  })

  // Change Cube's source to start the delayed automatic job.
  await cube.locator('.node-add-summary').click()
  await cube.getByText('Size', { exact: true }).click()
  await cube.getByRole('button', { name: 'Scalar', exact: true }).click()
  await expect.poll(async () => (await renderCalls(page)).length).toBe(1)
  await cube.locator('[data-param-key="size"] input').fill('11')
  await expect.poll(async () => (await renderCalls(page)).length, { timeout: 20_000 }).toBe(2)
  await waitForExecutionIdle(page)
  expect((await renderCalls(page))[1]?.timeoutMs).toBe(15_000)
  await page.evaluate(() => (window as unknown as { resolveStaleRender(): void }).resolveStaleRender())

  await cube.locator('[data-param-key="size"] input').fill('10')
  await expect.poll(async () => (await renderCalls(page)).length, { timeout: 20_000 }).toBe(3)
  await waitForExecutionIdle(page)
})

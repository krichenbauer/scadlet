import { expect, type Locator, type Page } from './fixtures'

export interface Bounds {
  x: number
  y: number
  width: number
  height: number
}

/** Lets a synchronous user action propagate through Lit and the next paint. */
export async function waitForUiCommit(page: Page): Promise<void> {
  await page.evaluate(() => new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
  }))
}

/** Waits for an asynchronously rendered element to have real layout bounds. */
export async function waitForBoundingBox(locator: Locator): Promise<Bounds> {
  let bounds: Bounds | null = null
  await expect.poll(async () => {
    bounds = await locator.boundingBox()
    return bounds !== null
  }).toBe(true)
  if (!bounds) throw new Error('Expected stable element bounds after render')
  return bounds
}

/**
 * Autosave is complete when the app's observable dirty marker clears. Two
 * animation frames first let an immediately preceding semantic event reach
 * Lit; unlike a fixed sleep, the final wait follows the actual save state.
 */
export async function waitForAutosave(page: Page): Promise<void> {
  await waitForUiCommit(page)
  await expect.poll(() => page.locator('scadlet-app').evaluate((element) => {
    const app = element as unknown as { dirty: boolean; autosaveStatus: string }
    return { dirty: app.dirty, status: app.autosaveStatus }
  }), { timeout: 10_000 }).toEqual({ dirty: false, status: 'idle' })
  await expect(page.locator('scadlet-app .persistence-status')).toHaveCount(0)
}

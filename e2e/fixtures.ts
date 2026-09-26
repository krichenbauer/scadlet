import { expect, test as base } from '@playwright/test'

export { expect }
export type { Locator, Page } from '@playwright/test'

/**
 * Every test receives Playwright's ordinary fresh page/context. This automatic
 * fixture adds only deterministic browser capabilities and failure artifacts;
 * it deliberately owns no cross-test application or persistence state.
 */
export const test = base.extend<{ failureDiagnostics: void }>({
  failureDiagnostics: [async ({ context, page }, use, testInfo) => {
    await context.addInitScript(() => {
      // Native picker UI is not portable in headless CI. All tests exercise
      // the same file-input/download implementation instead.
      Object.defineProperty(window, 'showOpenFilePicker', { value: undefined, configurable: true })
      Object.defineProperty(window, 'showSaveFilePicker', { value: undefined, configurable: true })
    })

    const browserErrors: string[] = []
    page.on('console', (message) => {
      if (message.type() === 'error') browserErrors.push(`console: ${message.text()}`)
    })
    page.on('pageerror', (error) => browserErrors.push(`pageerror: ${error.stack ?? error.message}`))

    await use()

    if (testInfo.status === testInfo.expectedStatus) return
    if (browserErrors.length > 0) {
      await testInfo.attach('browser-errors.txt', {
        body: Buffer.from(browserErrors.join('\n\n')),
        contentType: 'text/plain',
      })
    }
    if (page.isClosed()) return
    try {
      const diagnostics = await page.evaluate(() => {
        const app = document.querySelector('scadlet-app')?.shadowRoot
        return {
          source: app?.querySelector('.scad-output')?.textContent ?? '',
          renderError: app?.querySelector('.render-error')?.textContent ?? '',
          persistenceStatus: app?.querySelector('.persistence-status')?.textContent ?? '',
          activeProjectId: sessionStorage.getItem('scadlet.activeProjectId'),
        }
      })
      await testInfo.attach('scadlet-diagnostics.json', {
        body: Buffer.from(JSON.stringify(diagnostics, null, 2)),
        contentType: 'application/json',
      })
    } catch {
      // The trace/screenshot/video still capture failures where navigation or
      // browser teardown made the page unavailable before fixture cleanup.
    }
  }, { auto: true }],
})

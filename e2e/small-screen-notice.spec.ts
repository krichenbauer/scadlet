import { expect, test } from '@playwright/test'

test('keeps the small-screen notice absent on a normal desktop viewport', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('scadlet-app .project-name')).toBeEnabled()
  await expect(page.locator('scadlet-app .small-screen-notice')).toBeHidden()
  await expect(page.locator('scadlet-app .application-shell')).not.toHaveAttribute('hidden', '')
})

test.describe('coarse-pointer viewport', () => {
  test.use({ hasTouch: true, viewport: { width: 390, height: 844 } })

  test('shows concise English guidance and a safe prominent GitHub link on a phone', async ({ page }) => {
    await page.goto('/')
    expect(await page.evaluate(() => matchMedia('(pointer: coarse)').matches)).toBe(true)

    const notice = page.locator('scadlet-app .small-screen-notice')
    await expect(notice).toBeVisible()
    await expect(page.locator('scadlet-app .application-shell')).toHaveAttribute('hidden', '')
    await expect(notice.getByRole('heading', { name: 'A larger screen is required' })).toBeVisible()
    await expect(notice).toContainText('SCADlet is designed for a larger display. Open it on a desktop or suitably large tablet.')

    const github = notice.getByRole('link', { name: 'View SCADlet on GitHub' })
    await expect(github).toHaveAttribute('href', 'https://github.com/krichenbauer/scadlet')
    await expect(github).toHaveAttribute('target', '_blank')
    await expect(github).toHaveAttribute('rel', /noopener/)
    await expect(github).toHaveAttribute('rel', /noreferrer/)
  })

  test('updates live across phone, tablet, and orientation-sized viewports', async ({ page }) => {
    await page.goto('/')
    const notice = page.locator('scadlet-app .small-screen-notice')
    const shell = page.locator('scadlet-app .application-shell')
    await expect(notice).toBeVisible()

    // A 768px portrait tablet clears both conservative minimums.
    await page.setViewportSize({ width: 768, height: 1024 })
    await expect(notice).toBeHidden()
    await expect(shell).not.toHaveAttribute('hidden', '')
    await expect(page.locator('scadlet-app .project-name')).toBeEnabled()
    const activeProjectId = await page.evaluate(() => {
      const editor = document.querySelector('scadlet-app')?.shadowRoot?.querySelector('node-editor')
      ;(window as unknown as { mobileNoticeEditor?: Element | null }).mobileNoticeEditor = editor
      return sessionStorage.getItem('scadlet.activeProjectId')
    })

    // Phone landscape is wide but still too short for the editor/viewer.
    await page.setViewportSize({ width: 844, height: 390 })
    await expect(notice).toBeVisible()
    await expect(shell).toHaveAttribute('hidden', '')

    // A suitably large landscape tablet returns to the full application.
    await page.setViewportSize({ width: 1024, height: 768 })
    await expect(notice).toBeHidden()
    await expect(shell).not.toHaveAttribute('hidden', '')
    expect(await page.evaluate(() => {
      const retained = (window as unknown as { mobileNoticeEditor?: Element | null }).mobileNoticeEditor
      const current = document.querySelector('scadlet-app')?.shadowRoot?.querySelector('node-editor')
      return retained === current
        && sessionStorage.getItem('scadlet.activeProjectId') !== null
    })).toBe(true)
    expect(await page.evaluate(() => sessionStorage.getItem('scadlet.activeProjectId'))).toBe(activeProjectId)
  })
})

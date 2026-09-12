import { expect, test } from '@playwright/test'

test('keeps local projects, portable files, and manual preview controls visibly separate', async ({ page }) => {
  await page.goto('/')
  const name = page.locator('scadlet-app .project-name')
  await expect(name).toBeEnabled()

  // Header rename commits on Enter and is the only visible rename affordance.
  await name.fill('Header rename')
  await name.press('Enter')
  await expect(name).toHaveValue('Header rename')
  await name.fill('Blur rename')
  await name.press('Tab')
  await expect(name).toHaveValue('Blur rename')

  await page.getByRole('button', { name: 'Projects' }).click()
  await expect(page.getByRole('button', { name: '+ New project' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Duplicate' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Delete', exact: true })).toBeVisible()
  await expect(page.locator('scadlet-app .project-row--active')).toHaveCount(1)
  await expect(page.locator('scadlet-app .project-row').filter({ hasText: 'Rename' })).toHaveCount(0)

  await page.getByRole('button', { name: 'File' }).click()
  await expect(page.getByRole('menuitem', { name: 'Open' })).toBeVisible()
  await expect(page.getByRole('menuitem', { name: 'Save .scadlet' })).toBeVisible()
  await expect(page.getByRole('menuitem', { name: 'Download .scad' })).toBeVisible()
  await expect(page.getByRole('menuitem', { name: 'Download .stl' })).toBeVisible()

  const github = page.getByRole('link', { name: 'Open SCADlet on GitHub' })
  await expect(github).toHaveAttribute('href', 'https://github.com/krichenbauer/scadlet')
  await expect(github).toHaveAttribute('title', 'Open SCADlet on GitHub')

  const live = page.getByRole('button', { name: 'Live' })
  await expect(live).toHaveAttribute('aria-pressed', 'true')
  await live.click()
  await expect(live).toHaveAttribute('aria-pressed', 'false')
  await expect(page.locator('geometry-viewer .render-spinner')).toHaveCount(0)
})

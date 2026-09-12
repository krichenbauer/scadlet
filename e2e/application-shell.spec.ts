import { expect, test } from '@playwright/test'

test('polishes the shell with accessible icons and a UI-only Live slider', async ({ page }) => {
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

  const headerOrder = await page.locator('scadlet-app header').evaluate((header) => [...header.children].map((child) => {
    if (child.matches('[aria-label="Project name"]')) return 'name'
    if (child.querySelector('[aria-label="Projects"]')) return 'projects'
    if (child.querySelector('[aria-expanded]')) return 'file'
    if (child.matches('h1')) return 'wordmark'
    if (child.matches('a')) return 'github'
    return 'spacer'
  }))
  expect(headerOrder).toEqual(['file', 'name', 'projects', 'spacer', 'wordmark', 'github'])

  await page.getByRole('button', { name: 'Projects' }).click()
  for (const label of ['New project', 'Duplicate active project', 'Delete active project']) {
    const action = page.getByRole('button', { name: label })
    await expect(action).toBeVisible()
    await expect(action).toHaveAttribute('title', label)
    await action.focus()
    await expect(action).toBeFocused()
  }
  await expect(page.locator('scadlet-app .project-row--active')).toHaveCount(1)
  await expect(page.locator('scadlet-app .project-row').filter({ hasText: 'Rename' })).toHaveCount(0)
  const sort = page.getByRole('combobox', { name: 'Sort:' })
  await expect(sort).toHaveValue('recent')
  await sort.selectOption('alphabetical')
  await expect(sort).toHaveValue('alphabetical')
  await expect(page.locator('scadlet-app .sort-icon')).toHaveAttribute('title', 'A–Z')

  await page.getByRole('button', { name: 'File' }).click()
  await expect(page.getByRole('menuitem', { name: 'Open' })).toBeVisible()
  await expect(page.getByRole('menuitem', { name: 'Save .scadlet' })).toBeVisible()
  await expect(page.getByRole('menuitem', { name: 'Download .scad' })).toBeVisible()
  await expect(page.getByRole('menuitem', { name: 'Download .stl' })).toBeVisible()

  const github = page.getByRole('link', { name: 'Open SCADlet on GitHub' })
  await expect(github).toHaveAttribute('href', 'https://github.com/krichenbauer/scadlet')
  await expect(github).toHaveAttribute('title', 'Open SCADlet on GitHub')

  const live = page.locator('geometry-viewer .live-switch')
  await expect(live).toHaveAttribute('role', 'switch')
  await expect(live).toHaveAttribute('aria-label', 'Live render')
  await expect(live).toHaveAttribute('aria-checked', 'true')
  await expect(live).toHaveAttribute('title', 'Live render')
  await live.focus()
  await expect(live).toBeFocused()
  await live.press('Space')
  await expect(live).toHaveAttribute('aria-checked', 'false')
  await expect(page.locator('geometry-viewer .render-spinner')).toHaveCount(0)
})

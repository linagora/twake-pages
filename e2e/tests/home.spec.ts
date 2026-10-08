import { expect, test } from '@playwright/test'
import { signIn } from './signIn.ts'

test('signs alice in to the home, with its navigation and her personal wiki', async ({
  page
}) => {
  await signIn(page, 'alice')

  await expect(
    page.getByRole('heading', { level: 1, name: 'Twake Pages' })
  ).toBeVisible()
  await expect(
    page.getByRole('navigation').getByRole('link', { name: 'Wikis' })
  ).toHaveAttribute('aria-current', 'page')
  await expect(page.getByRole('button', { name: 'Alice Martin' })).toBeVisible()
  await expect(
    page.getByRole('list', { name: 'Wikis' }).getByRole('listitem').first()
  ).toHaveText('Personal')
})

test('opens her personal wiki on its home page', async ({ page }) => {
  await signIn(page, 'alice')

  await page
    .getByRole('list', { name: 'Wikis' })
    .getByRole('link', { name: 'Personal' })
    .click()

  await expect(page).toHaveURL(/\/wikis\/[^/]+$/)
  await expect(
    page.getByRole('heading', { level: 1, name: 'Personal' })
  ).toBeVisible()
  await expect(
    page
      .getByRole('navigation', { name: 'Wiki' })
      .getByRole('link', { name: 'Home page' })
  ).toHaveAttribute('aria-current', 'page')
  await expect(page.getByText('This page is empty.')).toBeVisible()
})

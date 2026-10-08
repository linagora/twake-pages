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

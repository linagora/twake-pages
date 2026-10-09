import { expect, test } from '@playwright/test'
import { aliceWiki, newPage } from './wiki.ts'

test('adds the label "howto" to "Onboarding", which the wiki\'s labels then show, and the label\'s page lists "Onboarding"', async ({
  page
}) => {
  await aliceWiki(page)
  await newPage(page, 'Onboarding')

  await page.getByRole('button', { name: 'Edit labels' }).click()
  const picker = page.getByRole('dialog', { name: 'Labels of Onboarding' })
  const search = picker.getByRole('textbox', { name: 'Search labels' })
  await search.fill('howto')
  await picker.getByRole('menuitem', { name: 'Create “howto”' }).click()
  await expect(
    picker.getByRole('menuitemcheckbox', { name: 'howto' })
  ).toBeChecked()
  await search.press('Escape')
  await expect(picker).toBeHidden()

  await expect(
    page.getByRole('list', { name: 'Page labels' }).getByRole('link')
  ).toHaveText(['howto'])
  const howto = page
    .getByRole('navigation', { name: 'Wiki' })
    .getByRole('list', { name: 'Labels' })
    .getByRole('link', { name: 'howto, 1 page' })
  await expect(howto).toBeVisible()

  await howto.click()

  await expect(
    page.getByRole('heading', { level: 1, name: 'Pages labelled howto' })
  ).toBeVisible()
  await expect(
    page.getByRole('list', { name: 'Pages labelled howto' }).getByRole('link')
  ).toHaveText(['Onboarding'])
})

import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { aliceWiki, newPage } from './wiki.ts'

test('marks "Onboarding" as a favorite, then finds it on the home screen under favorites and in Recent', async ({
  page
}) => {
  // Other scenarios give alice an "Onboarding" too: this one is told by its wiki.
  const wiki = `Engineering ${randomUUID().slice(0, 8)}`
  await aliceWiki(page, wiki)
  await newPage(page, 'Onboarding')

  await page.getByRole('button', { name: 'Add to favorites' }).click()
  await expect(
    page.getByRole('button', { name: 'Remove from favorites' })
  ).toBeVisible()
  await page
    .getByRole('navigation')
    .getByRole('link', { name: 'Wikis', exact: true })
    .click()

  const onboardingIn = (shelf: string) =>
    page
      .getByRole('list', { name: shelf })
      .getByRole('listitem', { name: 'Onboarding' })
      .filter({ hasText: wiki })
  await expect(onboardingIn('Favorites')).toBeVisible()
  await expect(onboardingIn('Recent')).toBeVisible()
})

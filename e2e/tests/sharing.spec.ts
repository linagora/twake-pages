import { expect, test } from '@playwright/test'
import { publishText } from './editor.ts'
import {
  aliceOnboardingSharedWithBob,
  bobOnOnboarding,
  changeRole
} from './sharing.ts'

test('shares "Engineering" with bob as viewer, who signs in at its address and opens a page of it but cannot edit it, until alice makes him editor', async ({
  page,
  browser
}) => {
  const wiki = await aliceOnboardingSharedWithBob(page, 'Viewer')

  const bob = await bobOnOnboarding(browser, wiki)
  // Were bob an editor, the link would show with the title.
  const edit = bob.getByRole('link', { name: 'Edit page' })
  await expect(edit).toHaveCount(0)

  await page
    .getByRole('navigation', { name: 'Wiki' })
    .getByRole('link', { name: 'Home page' })
    .click()
  await changeRole(page, 'Bob Durand', 'Editor')

  await expect(edit).toBeVisible()
  await publishText(bob, 'Ask bob for a laptop.')
  await expect(
    bob.getByRole('main').getByText('Version 2', { exact: true })
  ).toBeVisible()
})

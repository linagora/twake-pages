import { expect, test, type Page } from '@playwright/test'
import { publishText, typeInBlocks } from './editor.ts'
import { aliceOnboardingSharedWithBob, bobOnOnboarding } from './sharing.ts'
import { aliceWiki, newPage } from './wiki.ts'

const TEXT = 'Bring your badge on the first day.'
const BOB_TEXT = 'Ask IT for a laptop before the first day.'

/** Alice's new page "Onboarding", in a wiki of her own, open in her browser. */
async function aliceOnboarding(page: Page) {
  await aliceWiki(page)
  await newPage(page, 'Onboarding')
}

/** "Onboarding" shown with the text typed in it, as its version 2. */
async function expectPublished(page: Page) {
  const main = page.getByRole('main')
  await expect(
    main.getByRole('heading', { level: 1, name: 'Onboarding' })
  ).toBeVisible()
  await expect(main.getByText(TEXT)).toBeVisible()
  await expect(main.getByText('Version 2', { exact: true })).toBeVisible()
}

test('edits "Onboarding", types text and publishes it: the page shows the text as version 2, after a reload too', async ({
  page
}) => {
  await aliceOnboarding(page)

  await publishText(page, TEXT)

  await expectPublished(page)
  await page.reload()
  await expectPublished(page)
})

test('offers the draft of "Onboarding" back after a reload, then publishes it', async ({
  page
}) => {
  await aliceOnboarding(page)
  await page.getByRole('link', { name: 'Edit page' }).click()
  await typeInBlocks(page, TEXT)

  await page.reload()

  await expect(
    page.getByText(/^This is your draft, started from version 1\./)
  ).toBeVisible()
  await expect(page.getByRole('textbox', { name: 'Content' })).toContainText(
    TEXT
  )
  await page.getByRole('button', { name: 'Publish' }).click()
  await expectPublished(page)
})

test('meets the edit conflict as bob, an editor, publishes "Onboarding" while alice writes it, then publishes over his version: the page has her text', async ({
  page,
  browser
}) => {
  const wiki = await aliceOnboardingSharedWithBob(page, 'Editor')
  const bob = await bobOnOnboarding(browser, wiki)
  await page.getByRole('link', { name: 'Edit page' }).click()
  // Her draft starts from the version her editor opens on: before bob's.
  await expect(
    page.getByRole('heading', { level: 1, name: 'Edit page' })
  ).toBeVisible()

  await publishText(bob, BOB_TEXT)
  await expect(
    bob.getByRole('main').getByText('Version 2', { exact: true })
  ).toBeVisible()
  await typeInBlocks(page, TEXT)
  await page.getByRole('button', { name: 'Publish' }).click()

  await expect(
    page
      .getByRole('alert')
      .filter({ hasText: 'Bob Durand published version 2 on ' })
  ).toBeVisible()
  await page.getByRole('button', { name: 'Publish over it' }).click()
  await page
    .getByRole('dialog', { name: 'Publish over version 2?' })
    .getByRole('button', { name: 'Publish over it' })
    .click()
  const main = page.getByRole('main')
  await expect(main.getByText(TEXT)).toBeVisible()
  await expect(main.getByText('Version 3', { exact: true })).toBeVisible()
  await expect(main.getByText(BOB_TEXT)).toHaveCount(0)
})

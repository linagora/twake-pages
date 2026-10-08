import { expect, test, type Page } from '@playwright/test'
import { typeInBlocks } from './editor.ts'
import { signIn } from './signIn.ts'

const TEXT = 'Bring your badge on the first day.'

/** Alice's new page "Onboarding", in a wiki of her own, open in her browser. */
async function aliceOnboarding(page: Page) {
  await signIn(page, 'alice')
  await page.getByRole('button', { name: 'New wiki' }).click()
  const newWiki = page.getByRole('dialog', { name: 'New wiki' })
  await newWiki.getByRole('textbox', { name: 'Name' }).fill('Engineering')
  await newWiki.getByRole('button', { name: 'Create' }).click()
  await page.getByRole('button', { name: 'New page' }).click()
  const newPage = page.getByRole('dialog', { name: 'New page' })
  await newPage.getByRole('textbox', { name: 'Title' }).fill('Onboarding')
  await newPage.getByRole('button', { name: 'Create' }).click()
  await expect(
    page.getByRole('heading', { level: 1, name: 'Onboarding' })
  ).toBeVisible()
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

  await page.getByRole('link', { name: 'Edit page' }).click()
  await typeInBlocks(page, TEXT)
  await page.getByRole('button', { name: 'Publish' }).click()

  await expectPublished(page)
  await page.reload()
  await expectPublished(page)
})

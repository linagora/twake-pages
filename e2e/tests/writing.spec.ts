import { expect, test, type Page } from '@playwright/test'
import { typeInBlocks } from './editor.ts'
import { aliceWiki, newPage } from './wiki.ts'

const TEXT = 'Bring your badge on the first day.'

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

  await page.getByRole('link', { name: 'Edit page' }).click()
  await typeInBlocks(page, TEXT)
  await page.getByRole('button', { name: 'Publish' }).click()

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

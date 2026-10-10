import { expect, type Page } from '@playwright/test'

/**
 * Types `text` in the blocks of the editor open on `page`: in place of the
 * block holding `replacing`, or else in blocks still empty.
 */
export async function typeInBlocks(
  page: Page,
  text: string,
  replacing?: string
) {
  const blocks = page.getByRole('textbox', { name: 'Content' })
  // Three clicks select the text of the whole block, which typing replaces.
  if (replacing === undefined) await blocks.click()
  else await blocks.getByText(replacing).click({ clickCount: 3 })
  await page.keyboard.type(text)
  await expect(blocks).toContainText(text)
}

/**
 * Publishes the draft of the editor open on `page`, and waits for the page to
 * come back.
 */
export async function publishDraft(page: Page) {
  await page.getByRole('button', { name: 'Publish' }).click()
  // The editor leaves for the page once the version is published.
  await expect(page.getByRole('link', { name: 'Edit page' })).toBeVisible()
}

/**
 * Publishes `text` from the editor of the page open on `page`, in place of
 * the block holding `replacing`, or else in blocks still empty, and waits for
 * the page to show it.
 */
export async function publishText(
  page: Page,
  text: string,
  replacing?: string
) {
  await page.getByRole('link', { name: 'Edit page' }).click()
  await typeInBlocks(page, text, replacing)
  await publishDraft(page)
  await expect(page.getByRole('main').getByText(text)).toBeVisible()
}

import { expect, type Page } from '@playwright/test'

/** Types `text` in the blocks of the editor open on `page`, still empty. */
export async function typeInBlocks(page: Page, text: string) {
  const blocks = page.getByRole('textbox', { name: 'Content' })
  await blocks.click()
  await page.keyboard.type(text)
  await expect(blocks).toContainText(text)
}

/**
 * Publishes `text` from the editor of the page open on `page`, still empty,
 * and waits for the page to show it.
 */
export async function publishText(page: Page, text: string) {
  await page.getByRole('link', { name: 'Edit page' }).click()
  await typeInBlocks(page, text)
  await page.getByRole('button', { name: 'Publish' }).click()
  // The editor leaves for the page once the version is published.
  await expect(page.getByRole('link', { name: 'Edit page' })).toBeVisible()
  await expect(page.getByRole('main').getByText(text)).toBeVisible()
}

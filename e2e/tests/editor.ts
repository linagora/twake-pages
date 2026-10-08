import { expect, type Page } from '@playwright/test'

/** Types `text` in the blocks of the editor open on `page`, still empty. */
export async function typeInBlocks(page: Page, text: string) {
  const blocks = page.getByRole('textbox', { name: 'Content' })
  await blocks.click()
  await page.keyboard.type(text)
  await expect(blocks).toContainText(text)
}

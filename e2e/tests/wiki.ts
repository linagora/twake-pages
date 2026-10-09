import { expect, type Page } from '@playwright/test'
import { signIn } from './signIn.ts'

/** A new wiki of alice's, signed in, open on its home page. */
export async function aliceWiki(page: Page, name = 'Engineering') {
  await signIn(page, 'alice')
  await page.getByRole('button', { name: 'New wiki' }).click()
  const dialog = page.getByRole('dialog', { name: 'New wiki' })
  await dialog.getByRole('textbox', { name: 'Name' }).fill(name)
  await dialog.getByRole('button', { name: 'Create' }).click()
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible()
}

/**
 * A new page at the top of the tree of the wiki open on `page`, from the
 * template named, open once created.
 */
export async function newPage(page: Page, title: string, template?: string) {
  await page.getByRole('button', { name: 'New page' }).click()
  const dialog = page.getByRole('dialog', { name: 'New page' })
  await dialog.getByRole('textbox', { name: 'Title' }).fill(title)
  if (template !== undefined) {
    await dialog
      .getByRole('combobox', { name: 'Template' })
      .selectOption({ label: template })
  }
  await dialog.getByRole('button', { name: 'Create' }).click()
  await expect(
    page.getByRole('heading', { level: 1, name: title })
  ).toBeVisible()
}

/** A new child page of the page open, named `parent`, open once created. */
export async function newChildPage(page: Page, parent: string, title: string) {
  await page.getByRole('button', { name: 'Page options' }).click()
  await page.getByRole('menuitem', { name: 'New child page' }).click()
  const dialog = page.getByRole('dialog', { name: `New page under ${parent}` })
  await dialog.getByRole('textbox', { name: 'Title' }).fill(title)
  await dialog.getByRole('button', { name: 'Create' }).click()
  await expect(
    page.getByRole('heading', { level: 1, name: title })
  ).toBeVisible()
}

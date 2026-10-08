import { expect, test } from '@playwright/test'
import { signIn } from './signIn.ts'

test('creates a page from the how-to template, then a child page under it, nested in the tree', async ({
  page
}) => {
  await signIn(page, 'alice')
  await page.getByRole('button', { name: 'New wiki' }).click()
  const newWiki = page.getByRole('dialog', { name: 'New wiki' })
  await newWiki.getByRole('textbox', { name: 'Name' }).fill('Engineering')
  await newWiki.getByRole('button', { name: 'Create' }).click()
  await expect(
    page.getByRole('heading', { level: 1, name: 'Engineering' })
  ).toBeVisible()

  await page.getByRole('button', { name: 'New page' }).click()
  const newPage = page.getByRole('dialog', { name: 'New page' })
  await newPage.getByRole('textbox', { name: 'Title' }).fill('Onboarding')
  await newPage
    .getByRole('combobox', { name: 'Template' })
    .selectOption({ label: 'How-to' })
  await newPage.getByRole('button', { name: 'Create' }).click()
  await expect(
    page.getByRole('heading', { level: 1, name: 'Onboarding' })
  ).toBeVisible()
  await expect(
    page.getByRole('main').getByRole('heading', { level: 2, name: 'Steps' })
  ).toBeVisible()

  await page.getByRole('button', { name: 'Page options' }).click()
  await page.getByRole('menuitem', { name: 'New child page' }).click()
  const newChild = page.getByRole('dialog', {
    name: 'New page under Onboarding'
  })
  await newChild.getByRole('textbox', { name: 'Title' }).fill('Laptop setup')
  await newChild.getByRole('button', { name: 'Create' }).click()
  await expect(
    page.getByRole('heading', { level: 1, name: 'Laptop setup' })
  ).toBeVisible()

  const tree = page.getByRole('tree', { name: 'Pages' })
  await expect(
    tree.getByRole('treeitem', { name: 'Onboarding' })
  ).toHaveAttribute('aria-level', '1')
  await expect(
    tree
      .getByRole('group', { name: 'Onboarding' })
      .getByRole('treeitem', { name: 'Laptop setup' })
  ).toHaveAttribute('aria-level', '2')
})

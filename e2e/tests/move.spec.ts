import { expect, test, type Page } from '@playwright/test'
import { signIn } from './signIn.ts'

/** Alice's Engineering wiki, open on Laptop setup, a child page of Onboarding. */
async function engineering(page: Page) {
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
}

test('moves a page to the top of the tree from its menu, then back under its parent with the keyboard', async ({
  page
}) => {
  await engineering(page)
  const tree = page.getByRole('tree', { name: 'Pages' })
  const laptopSetup = tree.getByRole('treeitem', { name: 'Laptop setup' })
  const path = page
    .getByRole('navigation', { name: 'Path to this page' })
    .getByRole('link')
  await expect(laptopSetup).toHaveAttribute('aria-level', '2')

  await page.getByRole('button', { name: 'Page options' }).click()
  await page.getByRole('menuitem', { name: 'Move' }).click()
  const move = page.getByRole('dialog', { name: 'Move Laptop setup' })
  await move
    .getByRole('combobox', { name: 'Parent' })
    .selectOption({ label: 'Top of the tree' })
  await move.getByRole('button', { name: 'Move' }).click()

  await expect(laptopSetup).toHaveAttribute('aria-level', '1')
  await expect(path).toHaveText(['Engineering'])
  await expect(
    page.getByText(
      'Laptop setup moved to the top of the tree, position 2 of 2.'
    )
  ).toHaveAttribute('role', 'status')

  await laptopSetup.focus()
  await page.keyboard.press('Alt+Shift+ArrowRight')

  await expect(
    tree
      .getByRole('group', { name: 'Onboarding' })
      .getByRole('treeitem', { name: 'Laptop setup' })
  ).toHaveAttribute('aria-level', '2')
  await expect(laptopSetup).toBeFocused()
  await expect(path).toHaveText(['Engineering', 'Onboarding'])
  await expect(
    page.getByText('Laptop setup moved under Onboarding, position 1 of 1.')
  ).toHaveAttribute('role', 'status')
})

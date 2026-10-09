import { expect, test } from '@playwright/test'
import { aliceWiki, newChildPage, newPage } from './wiki.ts'

test('creates a page from the how-to template, then a child page under it, nested in the tree', async ({
  page
}) => {
  await aliceWiki(page)

  await newPage(page, 'Onboarding', 'How-to')
  await expect(
    page.getByRole('main').getByRole('heading', { level: 2, name: 'Steps' })
  ).toBeVisible()

  await newChildPage(page, 'Onboarding', 'Laptop setup')

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

import { expect, test } from '@playwright/test'
import { pageEvents } from './platform.ts'
import { engineering } from './wiki.ts'

test('deletes a page with its child page, then restores both from the trash, nested, putting page.deleted and page.restored on the activity exchange', async ({
  page
}) => {
  await engineering(page)
  const tree = page.getByRole('tree', { name: 'Pages' })
  await tree.getByRole('treeitem', { name: 'Onboarding' }).click()
  await expect(
    page.getByRole('heading', { level: 1, name: 'Onboarding' })
  ).toBeVisible()
  const pageId = page.url().split('/').at(-1) ?? ''

  await page.getByRole('button', { name: 'Page options' }).click()
  await page.getByRole('menuitem', { name: 'Delete' }).click()
  await page
    .getByRole('dialog', { name: 'Delete Onboarding?' })
    .getByRole('button', { name: 'Delete' })
    .click()

  await expect(
    page.getByRole('heading', { level: 1, name: 'Engineering' })
  ).toBeVisible()
  await expect(tree.getByRole('treeitem', { name: 'Onboarding' })).toHaveCount(
    0
  )
  await expect(
    tree.getByRole('treeitem', { name: 'Laptop setup' })
  ).toHaveCount(0)

  await page
    .getByRole('navigation', { name: 'Wiki' })
    .getByRole('link', { name: 'Trash' })
    .click()
  const trash = page.getByRole('list', { name: 'Trash' })
  await expect(trash.getByRole('listitem')).toHaveCount(1)
  await expect(
    trash.getByRole('listitem', { name: 'Onboarding' })
  ).toContainText('Onboarding · 1 page inside')

  await trash.getByRole('button', { name: 'Restore Onboarding' }).click()

  await expect(page.getByText('The trash is empty')).toBeVisible()
  await expect(
    tree.getByRole('treeitem', { name: 'Onboarding' })
  ).toHaveAttribute('aria-level', '1')
  await expect(
    tree
      .getByRole('group', { name: 'Onboarding' })
      .getByRole('treeitem', { name: 'Laptop setup' })
  ).toHaveAttribute('aria-level', '2')
  const branch = {
    object: expect.objectContaining({ id: pageId, title: 'Onboarding' }),
    descendants: 1
  }
  await expect(() => {
    expect([
      ...pageEvents('deleted', pageId),
      ...pageEvents('restored', pageId)
    ]).toEqual([
      expect.objectContaining({
        type: 'com.twake.pages.page.deleted.v1',
        data: branch
      }),
      expect.objectContaining({
        type: 'com.twake.pages.page.restored.v1',
        data: branch
      })
    ])
  }).toPass({ timeout: 15_000 })
})

import { expect, test } from '@playwright/test'
import { engineering } from './wiki.ts'

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

test('moves a page out to the top of the tree, then along its siblings, with the arrows', async ({
  page
}) => {
  await engineering(page)
  const tree = page.getByRole('tree', { name: 'Pages' })
  const laptopSetup = tree.getByRole('treeitem', { name: 'Laptop setup' })
  const path = page
    .getByRole('navigation', { name: 'Path to this page' })
    .getByRole('link')
  await expect(laptopSetup).toHaveAttribute('aria-level', '2')

  await laptopSetup.focus()
  await page.keyboard.press('Alt+Shift+ArrowLeft')

  // Out to its parent's level, right after Onboarding
  await expect(laptopSetup).toHaveAttribute('aria-level', '1')
  await expect(laptopSetup).toBeFocused()
  await expect(path).toHaveText(['Engineering'])
  await expect(
    page.getByText(
      'Laptop setup moved to the top of the tree, position 2 of 2.'
    )
  ).toHaveAttribute('role', 'status')

  await page.keyboard.press('Alt+Shift+ArrowUp')

  await expect(laptopSetup).toHaveAttribute('aria-level', '1')
  await expect(laptopSetup).toBeFocused()
  await expect(
    page.getByText(
      'Laptop setup moved to the top of the tree, position 1 of 2.'
    )
  ).toHaveAttribute('role', 'status')

  await page.keyboard.press('Alt+Shift+ArrowDown')

  await expect(laptopSetup).toHaveAttribute('aria-level', '1')
  await expect(laptopSetup).toBeFocused()
  await expect(
    page.getByText(
      'Laptop setup moved to the top of the tree, position 2 of 2.'
    )
  ).toHaveAttribute('role', 'status')
})

test('drags a page from under its parent to the top of the tree, where it stays after a reload', async ({
  page
}) => {
  await engineering(page)
  const tree = page.getByRole('tree', { name: 'Pages' })
  const laptopSetup = tree.getByRole('treeitem', { name: 'Laptop setup' })
  await expect(laptopSetup).toHaveAttribute('aria-level', '2')

  const from = await laptopSetup.boundingBox()
  const to = await tree.boundingBox()
  if (!from || !to) throw new Error('The tree is not laid out')
  // Past the 6 pixels that pick the page up, then below the last row: the
  // last place at the top of the tree.
  await page.mouse.move(from.x + 40, from.y + 20)
  await page.mouse.down()
  await page.mouse.move(from.x + 60, from.y + 30, { steps: 4 })
  await page.mouse.move(to.x + to.width / 2, to.y + to.height + 10, {
    steps: 15
  })
  await page.mouse.up()

  await expect(laptopSetup).toHaveAttribute('aria-level', '1')
  await expect(
    page.getByText(
      'Laptop setup moved to the top of the tree, position 2 of 2.'
    )
  ).toHaveAttribute('role', 'status')

  await page.reload()
  await expect(laptopSetup).toHaveAttribute('aria-level', '1')
})

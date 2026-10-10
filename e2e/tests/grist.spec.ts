import { expect, test, type Page } from '@playwright/test'
import { aliceWiki, newPageDialog } from './wiki.ts'

// The stand-in Grist of the stack, on the Grist origin the deployment names
const GRIST = 'http://localhost:3504'
const BUDGET = `${GRIST}/o/docs/9mz3/Budget`

/**
 * The heading of the document framed on `page`, which the stand-in makes of
 * the path of its address: what the frame shows, not only its address.
 */
const framedBudget = (page: Page) =>
  page
    .frameLocator('iframe[title="Grist document"]')
    .getByRole('heading', { name: '/o/docs/9mz3/Budget' })

test('alice creates a database page at a Grist address, refused on another origin: the page frames its Grist document', async ({
  page
}) => {
  await aliceWiki(page)
  const dialog = await newPageDialog(page, 'Budget')
  await dialog
    .getByRole('combobox', { name: 'Type' })
    .selectOption({ label: 'Database' })
  const address = dialog.getByRole('textbox', { name: 'Grist address' })

  await address.fill('https://docs.example.com/o/docs/9mz3/Budget')
  await dialog.getByRole('button', { name: 'Create' }).click()
  await expect(address).toHaveAccessibleDescription(
    `Twake Pages shows Grist documents from ${GRIST} only.`
  )

  await address.fill(BUDGET)
  await dialog.getByRole('button', { name: 'Create' }).click()
  await expect(
    page.getByRole('heading', { level: 1, name: 'Budget' })
  ).toBeVisible()
  await expect(framedBudget(page)).toBeVisible()
  await expect(
    page.getByRole('link', { name: 'Open in Grist' })
  ).toHaveAttribute('href', BUDGET)
})

import { randomUUID } from 'node:crypto'
import { expect, test, type Page } from '@playwright/test'
import { publishText } from './editor.ts'
import { asPerson } from './signIn.ts'
import { aliceWiki, newPage } from './wiki.ts'

/** Searches every wiki of the person signed in on `page` for `text`. */
async function search(page: Page, text: string) {
  const field = page
    .getByRole('banner')
    .getByRole('searchbox', { name: 'Search' })
  await field.fill(text)
  await field.press('Enter')
  await expect(
    page.getByRole('heading', { level: 1, name: 'Search', exact: true })
  ).toBeVisible()
}

test('alice searches a word from "Onboarding"\'s text and finds it with the word highlighted; bob, who is no member, does not', async ({
  page,
  browser
}) => {
  // Other scenarios write in pages of alice's too: this word is this one's.
  const word = `badge${randomUUID().slice(0, 8)}`
  await aliceWiki(page)
  await newPage(page, 'Onboarding')
  await publishText(page, `Bring your ${word} on the first day.`)

  await search(page, word)

  const onboarding = page
    .getByRole('region', { name: `Results for “${word}”` })
    .getByRole('listitem', { name: 'Onboarding' })
  await expect(onboarding.locator('mark')).toHaveText(word)
  await onboarding.getByRole('link', { name: 'Onboarding' }).click()
  await expect(
    page.getByRole('heading', { level: 1, name: 'Onboarding' })
  ).toBeVisible()

  const bob = await asPerson(browser, 'bob')
  await search(bob, word)
  await expect(bob.getByText('No pages match')).toBeVisible()
})

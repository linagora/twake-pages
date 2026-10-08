import { expect, type Browser, type Page } from '@playwright/test'

export type Person = 'alice' | 'bob'

export async function signIn(page: Page, person: Person, path = '/') {
  await page.goto(path)
  await page.getByRole('button', { name: `Sign in as ${person}` }).click()
  await expect(page.getByRole('navigation')).toBeVisible()
}

/** A browser of its own, so each person has their own SSO session. */
export async function asPerson(browser: Browser, person: Person, path = '/') {
  const context = await browser.newContext()
  const page = await context.newPage()
  await signIn(page, person, path)
  return page
}

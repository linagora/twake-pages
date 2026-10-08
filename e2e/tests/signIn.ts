import { expect, type Browser, type Page } from '@playwright/test'
import { revokeAtBackend } from './platform.ts'

export type Person = 'alice' | 'bob'

// As the browser reaches the mock SSO
const SSO = 'https://oidc:8543'

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

/**
 * Signs the person out of the SSO in another tab of their browser: the SSO
 * forgets their session, and the backend refuses its tokens from then on.
 */
export async function signOutOfTheSso(page: Page) {
  const context = page.context()
  const sid = (await context.cookies(SSO)).find(
    cookie => cookie.name === 'e2e_sid'
  )?.value
  if (sid === undefined) throw new Error('Nobody is signed in to the SSO')
  const tab = await context.newPage()
  await tab.goto(`${SSO}/logout`)
  await tab.close()
  revokeAtBackend(sid)
}

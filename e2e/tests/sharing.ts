import { expect, type Browser, type Locator, type Page } from '@playwright/test'
import { asPerson, BOB } from './signIn.ts'
import { aliceWiki, newPage } from './wiki.ts'

/**
 * Opens the members of the wiki whose home page is open on `page`, lets
 * `change` change them in their dialog, then closes it.
 */
async function changeMembers(
  page: Page,
  change: (dialog: Locator) => Promise<void>
) {
  await page.getByRole('button', { name: 'Share' }).click()
  const dialog = page.getByRole('dialog', { name: /^Share / })
  await change(dialog)
  await dialog.getByRole('button', { name: 'Close' }).click()
  await expect(dialog).toBeHidden()
}

/** Invites `email` as `role` to the wiki whose home page is open on `page`. */
export async function share(page: Page, email: string, role: string) {
  await changeMembers(page, async dialog => {
    const form = dialog.getByRole('form', { name: 'Invite' })
    await form.getByRole('combobox', { name: 'Email' }).fill(email)
    await form.getByRole('button', { name: 'Role: Viewer' }).click()
    await page.getByRole('menuitem', { name: role }).click()
    await form.getByRole('button', { name: 'Invite' }).click()
    await expect(dialog.getByRole('status')).toHaveText(`Invited ${email}.`)
  })
}

/** Makes `member` `role` of the wiki whose home page is open on `page`. */
export async function changeRole(page: Page, member: string, role: string) {
  await changeMembers(page, async dialog => {
    const row = dialog.getByRole('listitem', { name: member })
    await row.getByRole('button', { name: /^Role: / }).click()
    await page.getByRole('menuitem', { name: role }).click()
    await expect(
      row.getByRole('button', { name: `Role: ${role}` })
    ).toBeVisible()
  })
}

/**
 * Alice's new wiki "Engineering", shared with bob as `role` before he signs
 * in, with its page "Onboarding" open in her browser. Returns the address of
 * the wiki, which the email of the invitation links to.
 */
export async function aliceOnboardingSharedWithBob(page: Page, role: string) {
  await aliceWiki(page)
  const wiki = new URL(page.url()).pathname
  await share(page, BOB.email, role)
  await newPage(page, 'Onboarding')
  return wiki
}

/**
 * Bob, in a browser of his own, signed in at the address of the wiki, as he
 * follows the link of his invitation, who opens its page "Onboarding" from
 * its tree.
 */
export async function bobOnOnboarding(browser: Browser, wiki: string) {
  const bob = await asPerson(browser, 'bob', wiki)
  await expect(
    bob.getByRole('heading', { level: 1, name: 'Engineering' })
  ).toBeVisible()
  await bob
    .getByRole('tree', { name: 'Pages' })
    .getByRole('treeitem', { name: 'Onboarding' })
    .click()
  await expect(
    bob.getByRole('heading', { level: 1, name: 'Onboarding' })
  ).toBeVisible()
  return bob
}

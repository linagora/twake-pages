import { expect, test, type Page } from '@playwright/test'
import { aliceOnboardingSharedWithBob, bobOnOnboarding } from './sharing.ts'
import { ALICE } from './signIn.ts'

/** The unread count the bar shows for the notifications, 0 when it shows none. */
async function unread(page: Page): Promise<number> {
  const label = await page
    .locator('a[href="/notifications"]')
    .getAttribute('aria-label')
  return Number(label?.match(/\d+/)?.[0] ?? 0)
}

test('tells alice of bob\'s mention of her on "Onboarding", counted in her bar and read as she opens it', async ({
  page,
  browser
}) => {
  const wiki = await aliceOnboardingSharedWithBob(page, 'Editor')
  const bob = await bobOnOnboarding(browser, wiki)
  const comments = bob.getByRole('region', { name: 'Comments' })
  const field = comments.getByRole('textbox', { name: 'Comment' })

  await field.pressSequentially('Welcome @')
  await bob
    .getByRole('listbox', { name: 'People to mention' })
    .getByRole('option', { name: `Alice Martin ${ALICE.email}` })
    .click()
  await field.pressSequentially('your laptop is ready.')
  await comments.getByRole('button', { name: 'Send' }).click()

  const comment = comments.getByRole('article', { name: 'Bob Durand' })
  await expect(comment).toContainText(
    'Welcome @Alice Martin your laptop is ready.'
  )
  await expect(comment.getByText('@Alice Martin')).toHaveAttribute(
    'title',
    ALICE.email
  )

  // Alice's bar counts her unread as it loads, not a minute later
  await page.reload()
  const counted = page.getByRole('link', {
    name: /^Notifications, [1-9]\d* unread$/
  })
  await expect(counted).toBeVisible()
  const before = await unread(page)

  await counted.click()
  // The mention, not a publish another spec made of the same page
  const mention = page
    .getByRole('list', { name: 'Notifications' })
    .getByRole('listitem', { name: 'Onboarding, unread' })
    .filter({ hasText: 'mentioned you' })
  await expect(mention).toContainText('Bob Durand mentioned you')

  await mention.getByRole('link', { name: 'Onboarding' }).click()
  await expect(
    page.getByRole('heading', { level: 1, name: 'Onboarding' })
  ).toBeVisible()
  await expect(
    page
      .getByRole('region', { name: 'Comments' })
      .getByRole('article', { name: 'Bob Durand' })
  ).toContainText('Welcome @Alice Martin your laptop is ready.')

  // Opening it marked it read: the bar counts one fewer, live, not a minute later
  await expect.poll(() => unread(page)).toBe(before - 1)
})

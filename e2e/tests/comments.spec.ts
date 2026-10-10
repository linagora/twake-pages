import { expect, test } from '@playwright/test'
import { aliceOnboardingSharedWithBob, bobOnOnboarding } from './sharing.ts'
import { ALICE } from './signIn.ts'

test('shows the comment bob, an editor, writes on "Onboarding" mentioning alice, picked by her name: the mention reads @Alice Martin, titled with her email', async ({
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
})

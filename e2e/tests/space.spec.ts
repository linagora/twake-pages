import { expect, test, type Page } from '@playwright/test'
import { publishPlatformEvent } from './platform.ts'
import { asPerson } from './signIn.ts'
import { aliceSpaceWiki, ORGANIZATION } from './space.ts'

// As the mock SSO has him
const BOB = {
  uuid: '0b0b0000-0000-4000-8000-000000000002',
  email: 'bob@acme.e2e.test'
}

const wikis = (page: Page) => page.getByRole('list', { name: 'Wikis' })

test("creates a space's wiki for its members, and opens it to a person added to the space", async ({
  page,
  browser
}) => {
  const { spaceId, name } = await aliceSpaceWiki(page)
  await expect(wikis(page).getByText(name, { exact: true })).toBeVisible()

  const bob = await asPerson(browser, 'bob')
  await expect(wikis(bob).getByRole('listitem').first()).toHaveText('Personal')
  await expect(wikis(bob).getByText(name, { exact: true })).toHaveCount(0)
  publishPlatformEvent('twake.space.member.added', {
    organizationId: ORGANIZATION,
    id: spaceId,
    members: [{ ...BOB, role: 'viewer' }]
  })
  await expect(async () => {
    await bob.reload()
    await expect(wikis(bob).getByText(name, { exact: true })).toBeVisible({
      timeout: 1000
    })
  }).toPass()
})

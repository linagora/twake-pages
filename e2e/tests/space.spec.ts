import { randomUUID } from 'node:crypto'
import { expect, test, type Page } from '@playwright/test'
import { publishPlatformEvent, wikiOfSpace } from './platform.ts'
import { asPerson, signIn } from './signIn.ts'

// As the mock SSO has them
const ORGANIZATION = 'acme.e2e.test'
const ALICE = {
  uuid: '0a11ce00-0000-4000-8000-000000000001',
  email: 'alice@acme.e2e.test'
}
const BOB = {
  uuid: '0b0b0000-0000-4000-8000-000000000002',
  email: 'bob@acme.e2e.test'
}

const wikis = (page: Page) => page.getByRole('list', { name: 'Wikis' })

test("creates a space's wiki for its members, and opens it to a person added to the space", async ({
  page,
  browser
}) => {
  const spaceId = randomUUID()
  const name = `Design Sprint ${spaceId.slice(0, 8)}`
  publishPlatformEvent('twake.space.created', {
    organizationId: ORGANIZATION,
    id: spaceId,
    name,
    members: [{ ...ALICE, role: 'admin' }]
  })

  await expect
    .poll(() => wikiOfSpace(spaceId), { timeout: 15_000 })
    .toEqual({ id: expect.any(String), kind: 'wiki' })
  await signIn(page, 'alice')
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

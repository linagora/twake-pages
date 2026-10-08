import { randomUUID } from 'node:crypto'
import { expect, type Page } from '@playwright/test'
import { publishPlatformEvent, wikiOfSpace } from './platform.ts'
import { signIn } from './signIn.ts'

// As the mock SSO has them
export const ORGANIZATION = 'acme.e2e.test'
const ALICE = {
  uuid: '0a11ce00-0000-4000-8000-000000000001',
  email: 'alice@acme.e2e.test'
}

/**
 * A space created with alice as its admin, once its wiki is provisioned and
 * TwakeSpace told of it, with alice signed in.
 */
export async function aliceSpaceWiki(page: Page) {
  const spaceId = randomUUID()
  const name = `Design Sprint ${spaceId.slice(0, 8)}`
  publishPlatformEvent('twake.space.created', {
    organizationId: ORGANIZATION,
    id: spaceId,
    name,
    members: [{ ...ALICE, role: 'admin' }]
  })

  let wikiId = ''
  await expect(() => {
    const wiki = wikiOfSpace(spaceId)
    if (wiki?.kind !== 'wiki') throw new Error('The wiki is not provisioned')
    wikiId = wiki.id
  }).toPass({ timeout: 15_000 })
  await signIn(page, 'alice')
  return { spaceId, wikiId, name }
}

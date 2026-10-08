import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest'
import type { PlatformEvent } from '../../events/envelope.ts'
import { RejectedEventError } from '../../events/router.ts'
import { createDb, inTenant } from '../../infra/db.ts'
import {
  aB2cUser,
  aSpaceWiki,
  aUser,
  joinWiki,
  purgeJobOf,
  startApp,
  versionOf,
  wikiRowsOf,
  type TestUser,
  type WikiSummary
} from '../../testing/app.ts'
import { pageFavorites, pageVisits } from '../pages/schema.ts'
import { keepSettings } from '../settings/events.ts'
import type { Role } from './access.ts'
import { accountRoutes } from './accounts.ts'

let api: Awaited<ReturnType<typeof startApp>>
const { sql, db } = createDb(inject('databaseUrl'))

beforeAll(async () => {
  api = await startApp()
})

afterAll(async () => {
  await api.close()
  await sql.end()
})

function deliver(routingKey: string, body: object) {
  const handler = accountRoutes.get(routingKey)
  if (!handler) throw new Error(`no handler for ${routingKey}`)
  const event: PlatformEvent = { routingKey, messageId: randomUUID(), body }
  return db.transaction(tx => handler(event, tx))
}

const wikisOf = async (user: TestUser) =>
  (await api.as(user).get('/wikis')).json<{ wikis: WikiSummary[] }>().wikis

const sharedWikisOf = async (user: TestUser) =>
  (await wikisOf(user)).filter(wiki => wiki.kind !== 'personal')

/** Someone of the person's tenant: their organization, or B2C. */
const aPeerOf = (user: TestUser): TestUser =>
  user.organizationId
    ? aUser({ organizationId: user.organizationId })
    : aB2cUser()

async function aWiki(
  admin: TestUser,
  name: string,
  members: [TestUser, Role][]
) {
  const wiki = (
    await api.as(admin).post('/wikis', { name })
  ).json<WikiSummary>()
  for (const [user, role] of members) {
    await joinWiki(db, admin, wiki.id, user, role)
  }
  return wiki
}

async function personalWikiOf(user: TestUser) {
  const personal = (await wikisOf(user)).find(wiki => wiki.kind === 'personal')
  if (!personal) throw new Error('no personal wiki')
  return personal
}

/**
 * The pages the person keeps as favorites and recent pages, which no route
 * lists yet.
 */
const favoritesAndRecentOf = (user: TestUser) =>
  inTenant(db, user, async tx => ({
    favorites: await tx
      .select({ pageId: pageFavorites.pageId })
      .from(pageFavorites),
    recent: await tx.select({ pageId: pageVisits.pageId }).from(pageVisits)
  }))

describe.each([
  {
    kind: 'B2B, matched by email',
    routingKey: 'domain.user.deleted',
    makeUser: () => aUser(),
    body: (user: TestUser) => ({
      organizationId: user.organizationId,
      internalEmail: user.email
    })
  },
  {
    kind: 'B2B, matched by uuid',
    routingKey: 'domain.user.deleted',
    makeUser: () => aUser(),
    body: (user: TestUser) => ({
      organizationId: user.organizationId,
      uuid: user.userId
    })
  },
  {
    kind: 'B2C, matched by uuid',
    routingKey: 'user.deleted',
    makeUser: () => aB2cUser(),
    body: (user: TestUser) => ({ uuid: user.userId })
  },
  {
    kind: 'B2C, matched by email',
    routingKey: 'user.deleted',
    makeUser: () => aB2cUser(),
    body: (user: TestUser) => ({ internalEmail: user.email })
  }
])('a deleted account ($kind)', ({ routingKey, makeUser, body }) => {
  it('leaves its wikis, hands them on or deletes them, and loses its personal wiki', async () => {
    const gone = makeUser()
    const firstEditor = aPeerOf(gone)
    const laterEditor = aPeerOf(gone)
    const viewer = aPeerOf(gone)
    const personal = await personalWikiOf(gone)
    const handedOn = await aWiki(gone, 'Handbook', [
      [firstEditor, 'editor'],
      [laterEditor, 'editor']
    ])
    await aWiki(gone, 'Solo', [[viewer, 'viewer']])

    await deliver(routingKey, body(gone))

    expect(await sharedWikisOf(firstEditor)).toEqual([
      expect.objectContaining({ name: 'Handbook', role: 'admin' })
    ])
    expect(await sharedWikisOf(laterEditor)).toEqual([
      expect.objectContaining({ name: 'Handbook', role: 'editor' })
    ])
    expect(await sharedWikisOf(viewer)).toEqual([])
    expect((await api.as(gone).get(`/wikis/${handedOn.id}`)).statusCode).toBe(
      404
    )
    expect(await wikiRowsOf(db, gone, personal.id)).toEqual([])
  })

  it('moves the version of each wiki it leaves', async () => {
    const gone = makeUser()
    const admin = aPeerOf(gone)
    const editor = aPeerOf(gone)
    const left = await aWiki(admin, 'Roadmap', [[gone, 'viewer']])
    const handedOn = await aWiki(gone, 'Handbook', [[editor, 'editor']])
    const leftBefore = await versionOf(api, admin, left.id)
    const handedOnBefore = await versionOf(api, editor, handedOn.id)

    await deliver(routingKey, body(gone))

    expect(await versionOf(api, admin, left.id)).toBeGreaterThan(leftBefore)
    expect(await versionOf(api, editor, handedOn.id)).toBeGreaterThan(
      handedOnBefore
    )
  })

  it('leaves a wiki its admin deleted to its purge', async () => {
    const gone = makeUser()
    const admin = aPeerOf(gone)
    const deleted = await aWiki(admin, 'Archive', [[gone, 'viewer']])
    await api.as(admin).delete(`/wikis/${deleted.id}`)
    const job = await purgeJobOf(db, deleted.id)

    await deliver(routingKey, body(gone))

    expect(await purgeJobOf(db, deleted.id)).toEqual(job)
  })

  it('loses its favorites and recent pages', async () => {
    const gone = makeUser()
    const editor = aPeerOf(gone)
    // A wiki the person created, once handed on, still shows its pages to them
    // in B2C, so what they kept on those pages can be read as them.
    const handedOn = await aWiki(gone, 'Handbook', [[editor, 'editor']])
    const kept = {
      pageId: handedOn.homePageId,
      organizationId: gone.organizationId,
      userId: gone.userId
    }
    await inTenant(db, gone, async tx => {
      await tx.insert(pageFavorites).values(kept)
      await tx.insert(pageVisits).values(kept)
    })

    await deliver(routingKey, body(gone))

    expect(await favoritesAndRecentOf(gone)).toEqual({
      favorites: [],
      recent: []
    })
  })

  it('loses its Twake Workplace settings', async () => {
    const gone = makeUser()
    await wikisOf(gone)
    await db.transaction(tx =>
      keepSettings(tx, 1, {
        email: gone.email.toLowerCase(),
        display_name: 'Gone'
      })
    )

    await deliver(routingKey, body(gone))

    expect((await api.as(gone).get('/settings')).json()).toEqual({
      version: -1,
      language: null,
      timezone: null,
      theme: 'auto',
      avatar: null,
      name: null
    })
  })
})

describe('a deleted account in a space wiki', () => {
  it('leaves the wiki to its space, even as its only admin', async () => {
    const gone = aUser()
    const viewer = aUser({ organizationId: gone.organizationId })
    await aSpaceWiki(db, [
      [gone, 'admin'],
      [viewer, 'viewer']
    ])

    await deliver('domain.user.deleted', {
      organizationId: gone.organizationId,
      uuid: gone.userId
    })

    expect(await wikisOf(viewer)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'Marketing', role: 'viewer' })
      ])
    )
  })
})

describe('deleted accounts that cannot be applied', () => {
  it('rejects a B2B deletion without an organization', async () => {
    await expect(
      deliver('domain.user.deleted', { internalEmail: 'a@example.com' })
    ).rejects.toThrow(RejectedEventError)
  })

  it('rejects a B2B deletion without a uuid or an email', async () => {
    await expect(
      deliver('domain.user.deleted', { organizationId: randomUUID() })
    ).rejects.toThrow(RejectedEventError)
  })

  it('rejects a B2C deletion without a uuid or an email', async () => {
    await expect(deliver('user.deleted', { userId: 'alice' })).rejects.toThrow(
      RejectedEventError
    )
  })
})

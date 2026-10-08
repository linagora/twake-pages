import { randomUUID } from 'node:crypto'
import { eq, sql as raw } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest'
import type { PlatformEvent } from '../../events/envelope.ts'
import { RejectedEventError } from '../../events/router.ts'
import { asOrganization, createDb, inTenant } from '../../infra/db.ts'
import { jobs } from '../../scheduler/schema.ts'
import {
  aB2cUser,
  aPageIn,
  aSpaceWiki,
  aUser,
  joinWiki,
  purgeJobOf,
  startApp,
  versionOf,
  wikiRowsOf,
  wikisOf,
  type TestUser,
  type WikiSummary
} from '../../testing/app.ts'
import { comments } from '../comments/schema.ts'
import { pageFavorites, pageVersions, pageVisits } from '../pages/schema.ts'
import { keepSettings } from '../settings/events.ts'
import type { Role } from './access.ts'
import { accountRoutes } from './accounts.ts'
import { wikiMembers, wikis } from './schema.ts'

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

const sharedWikisOf = async (user: TestUser) =>
  (await wikisOf(api, user)).filter(wiki => wiki.kind === 'shared')

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
  const personal = (await wikisOf(api, user)).find(
    wiki => wiki.kind === 'personal'
  )
  if (!personal) throw new Error('no personal wiki')
  return personal
}

/** The members of the wiki, deleted or not, which no route lists yet. */
const membersOf = (reader: TestUser, wikiId: string) =>
  inTenant(db, reader, tx =>
    tx
      .select({ userId: wikiMembers.userId, role: wikiMembers.role })
      .from(wikiMembers)
      .where(eq(wikiMembers.wikiId, wikiId))
  )

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

/**
 * What the reader finds written in the wiki: the titles in its tree, and the
 * versions of its home page and the comments on it, which no route shows yet.
 */
async function writingsIn(wiki: WikiSummary, reader: TestUser) {
  const tree = (await api.as(reader).get(`/wikis/${wiki.id}/tree`)).json<{
    pages: { title: string }[]
  }>()
  return {
    titles: tree.pages.map(page => page.title),
    ...(await inTenant(db, reader, async tx => ({
      versions: await tx
        .select({
          number: pageVersions.number,
          authorId: pageVersions.authorId
        })
        .from(pageVersions)
        .where(eq(pageVersions.pageId, wiki.homePageId)),
      comments: await tx
        .select({ authorId: comments.authorId, body: comments.body })
        .from(comments)
        .where(eq(comments.pageId, wiki.homePageId))
    })))
  }
}

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
    const deleted = await aWiki(admin, 'Minutes', [[gone, 'viewer']])
    await api.as(admin).delete(`/wikis/${deleted.id}`)
    const job = await purgeJobOf(db, deleted.id)

    await deliver(routingKey, body(gone))

    expect(await purgeJobOf(db, deleted.id)).toEqual(job)
  })

  it('leaves a wiki it deleted to its purge, with an editor or none', async () => {
    const gone = makeUser()
    const editor = aPeerOf(gone)
    const edited = await aWiki(gone, 'Minutes', [[editor, 'editor']])
    const alone = await aWiki(gone, 'Ideas', [])
    await api.as(gone).delete(`/wikis/${edited.id}`)
    await api.as(gone).delete(`/wikis/${alone.id}`)
    const aloneBefore = await wikiRowsOf(db, gone, alone.id)

    await deliver(routingKey, body(gone))

    expect({
      edited: await membersOf(editor, edited.id),
      alone: await wikiRowsOf(db, gone, alone.id)
    }).toEqual({
      edited: [{ userId: editor.userId, role: 'editor' }],
      alone: [{ id: alone.id, version: aloneBefore[0]?.version }]
    })
  })

  it('leaves the pages, versions and comments it wrote', async () => {
    const gone = makeUser()
    const editor = aPeerOf(gone)
    const handedOn = await aWiki(gone, 'Handbook', [[editor, 'editor']])
    await aPageIn(db, gone, handedOn.id, {
      title: 'Onboarding',
      position: 'a0'
    })
    await inTenant(db, gone, tx =>
      tx.insert(comments).values({
        pageId: handedOn.homePageId,
        organizationId: gone.organizationId,
        authorId: gone.userId,
        authorEmail: gone.email,
        body: 'Welcome aboard'
      })
    )

    await deliver(routingKey, body(gone))

    expect(await writingsIn(handedOn, editor)).toEqual({
      titles: ['Onboarding'],
      versions: [{ number: 1, authorId: gone.userId }],
      comments: [{ authorId: gone.userId, body: 'Welcome aboard' }]
    })
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
    await wikisOf(api, gone)
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

    expect(await wikisOf(api, viewer)).toEqual(
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

describe('a deleted organization', () => {
  async function wikisHeldBy(organizationId: string | null) {
    return db.transaction(async tx => {
      await asOrganization(tx, organizationId)
      return tx.select({ id: wikis.id }).from(wikis)
    })
  }

  const jobsOf = (organizationId: string | null) =>
    db
      .select({ id: jobs.id })
      .from(jobs)
      .where(raw`${jobs.payload}->>'organizationId' = ${organizationId}`)

  it('erases everything the organization holds, and nothing of another', async () => {
    const admin = aUser()
    const organizationId = admin.organizationId
    const colleague = aUser({ organizationId })
    const outsider = aUser()
    const handbook = await aWiki(admin, 'Handbook', [[colleague, 'editor']])
    // Rows only the colleague may see, which go with the wiki all the same.
    await inTenant(db, colleague, async tx => {
      const own = {
        pageId: handbook.homePageId,
        organizationId,
        userId: colleague.userId
      }
      await tx.insert(pageFavorites).values(own)
      await tx.insert(pageVisits).values(own)
    })
    await aSpaceWiki(db, [[colleague, 'admin']])
    const deleted = await aWiki(admin, 'Minutes', [])
    await api.as(admin).delete(`/wikis/${deleted.id}`)
    const kept = await aWiki(outsider, 'Minutes', [])
    await api.as(outsider).delete(`/wikis/${kept.id}`)
    expect(await jobsOf(organizationId)).not.toEqual([])

    await deliver('domain.organization.deleted', {
      emitter: 'twake-ldap-rest',
      type: 'organization.deleted',
      organizationId,
      domain: 'example.com',
      reason: 'closed'
    })

    expect(await wikisHeldBy(organizationId)).toEqual([])
    expect(await jobsOf(organizationId)).toEqual([])
    expect(await favoritesAndRecentOf(colleague)).toEqual({
      favorites: [],
      recent: []
    })
    expect(await wikisHeldBy(outsider.organizationId)).not.toEqual([])
    expect(await jobsOf(outsider.organizationId)).not.toEqual([])
  })

  it('changes nothing when replayed', async () => {
    const admin = aUser()
    await aWiki(admin, 'Handbook', [])
    const body = { organizationId: admin.organizationId }

    await deliver('domain.organization.deleted', body)
    await deliver('domain.organization.deleted', body)

    expect(await wikisHeldBy(admin.organizationId)).toEqual([])
  })

  it('rejects a deletion without an organization', async () => {
    await expect(
      deliver('domain.organization.deleted', { domain: 'example.com' })
    ).rejects.toThrow(RejectedEventError)
  })
})

import { randomUUID } from 'node:crypto'
import { asc, eq, sql as raw } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest'
import type { PlatformEvent } from '../../events/envelope.ts'
import { RejectedEventError } from '../../events/router.ts'
import { asOrganization, createDb, inTenant } from '../../infra/db.ts'
import { jobs } from '../../scheduler/schema.ts'
import {
  aB2cUser,
  anEmail,
  aPageIn,
  aSpaceWiki,
  aUser,
  backIn,
  createPage,
  followingAndUnreadOf,
  invite,
  joinWiki,
  personalWikiOf,
  purgeJobOf,
  removeMember,
  startApp,
  versionOf,
  wikiRowsOf,
  wikisOf,
  type Page,
  type TestUser,
  type WikiSummary
} from '../../testing/app.ts'
import { comments } from '../comments/schema.ts'
import { notifications, pageFollowers } from '../notifications/schema.ts'
import { notify } from '../notifications/testing.ts'
import { pageFavorites, pageVersions, pageVisits } from '../pages/schema.ts'
import { keepSettings } from '../settings/events.ts'
import type { Role } from './access.ts'
import { accountRoutes } from './accounts.ts'
import { inviteEmails, wikiMembers, wikis } from './schema.ts'
import { behindAChange } from './testing.ts'

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

/** What `GET /wikis/:wikiId` answers the person: 404 for a wiki they left. */
const openingStatus = async (user: TestUser, wikiId: string) =>
  (await api.as(user).get(`/wikis/${wikiId}`)).statusCode

/** The members of the wiki, deleted or not, which no route lists yet. */
const membersOf = (reader: TestUser, wikiId: string) =>
  inTenant(db, reader, tx =>
    tx
      .select({ userId: wikiMembers.userId, role: wikiMembers.role })
      .from(wikiMembers)
      .where(eq(wikiMembers.wikiId, wikiId))
  )

/**
 * Makes the page one of the person's favorites and recent pages, and them its
 * follower, which no route does yet.
 */
const favoriteOpenAndFollow = (user: TestUser, pageId: string) =>
  inTenant(db, user, async tx => {
    const row = {
      pageId,
      organizationId: user.organizationId,
      userId: user.userId
    }
    await tx.insert(pageFavorites).values(row)
    await tx.insert(pageVisits).values(row)
    await tx.insert(pageFollowers).values(row)
  })

/**
 * What Pages keeps for the person about pages: their favorites, recent pages,
 * follows and notifications, which no route lists yet.
 */
const keptFor = (user: TestUser) =>
  inTenant(db, user, async tx => ({
    favorites: await tx
      .select({ pageId: pageFavorites.pageId })
      .from(pageFavorites),
    recent: await tx.select({ pageId: pageVisits.pageId }).from(pageVisits),
    // Anyone who sees a page sees who follows it.
    follows: await tx
      .select({ pageId: pageFollowers.pageId })
      .from(pageFollowers)
      .where(eq(pageFollowers.userId, user.userId)),
    notifications: await tx
      .select({ pageId: notifications.pageId })
      .from(notifications)
  }))

const NOTHING_KEPT = {
  favorites: [],
  recent: [],
  follows: [],
  notifications: []
}

/**
 * What the reader finds written in the wiki: the titles in its tree, and the
 * versions of its home page and the comments on it, which no route shows yet.
 */
async function pagesVersionsAndCommentsIn(wiki: WikiSummary, reader: TestUser) {
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

/**
 * The addresses of the invitation emails sent from the wiki, in their order,
 * which no route lists.
 */
const invitationEmailsOf = async (reader: TestUser, wikiId: string) =>
  (
    await inTenant(db, reader, tx =>
      tx
        .select({ email: inviteEmails.email })
        .from(inviteEmails)
        .where(eq(inviteEmails.wikiId, wikiId))
        .orderBy(asc(inviteEmails.sentAt))
    )
  ).map(row => row.email)

/** What `GET /settings` answers a person whose settings Pages does not keep. */
const NO_SETTINGS = {
  version: -1,
  language: null,
  timezone: null,
  theme: 'auto',
  avatar: null,
  name: null
}

const deletions = [
  {
    tenant: 'B2B',
    matchedBy: 'email',
    routingKey: 'domain.user.deleted',
    makeUser: () => aUser(),
    body: (user: TestUser) => ({
      organizationId: user.organizationId,
      internalEmail: user.email
    })
  },
  {
    tenant: 'B2B',
    matchedBy: 'uuid',
    routingKey: 'domain.user.deleted',
    makeUser: () => aUser(),
    body: (user: TestUser) => ({
      organizationId: user.organizationId,
      uuid: user.userId
    })
  },
  {
    tenant: 'B2C',
    matchedBy: 'uuid',
    routingKey: 'user.deleted',
    makeUser: () => aB2cUser(),
    body: (user: TestUser) => ({ uuid: user.userId })
  },
  {
    tenant: 'B2C',
    matchedBy: 'email',
    routingKey: 'user.deleted',
    makeUser: () => aB2cUser(),
    body: (user: TestUser) => ({ internalEmail: user.email })
  }
]

describe.each(deletions)(
  'a deleted account ($tenant, matched by $matchedBy)',
  ({ routingKey, makeUser, body }) => {
    it('leaves its wikis, hands them on or deletes them, and loses its personal wiki', async () => {
      const gone = makeUser()
      const admin = aPeerOf(gone)
      const firstEditor = aPeerOf(gone)
      const laterEditor = aPeerOf(gone)
      const viewer = aPeerOf(gone)
      const personal = await personalWikiOf(api, gone)
      const left = await aWiki(admin, 'Roadmap', [[gone, 'editor']])
      const handedOn = await aWiki(gone, 'Handbook', [
        [firstEditor, 'editor'],
        [laterEditor, 'editor']
      ])
      const deleted = await aWiki(gone, 'Solo', [[viewer, 'viewer']])

      await deliver(routingKey, body(gone))

      expect(await sharedWikisOf(firstEditor)).toEqual([
        expect.objectContaining({ name: 'Handbook', role: 'admin' })
      ])
      expect(await sharedWikisOf(laterEditor)).toEqual([
        expect.objectContaining({ name: 'Handbook', role: 'editor' })
      ])
      expect(await sharedWikisOf(viewer)).toEqual([])
      expect({
        left: await openingStatus(gone, left.id),
        handedOn: await openingStatus(gone, handedOn.id),
        deleted: await openingStatus(gone, deleted.id)
      }).toEqual({ left: 404, handedOn: 404, deleted: 404 })
      expect(await wikiRowsOf(db, gone, personal.id)).toEqual([])
    })

    it('promotes no one in a wiki another admin keeps', async () => {
      const gone = makeUser()
      const admin = aPeerOf(gone)
      const editor = aPeerOf(gone)
      await aWiki(gone, 'Handbook', [
        [admin, 'admin'],
        [editor, 'editor']
      ])

      await deliver(routingKey, body(gone))

      expect(await sharedWikisOf(admin)).toEqual([
        expect.objectContaining({ name: 'Handbook', role: 'admin' })
      ])
      expect(await sharedWikisOf(editor)).toEqual([
        expect.objectContaining({ name: 'Handbook', role: 'editor' })
      ])
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

    // A removal locks the wiki, then deletes the favorites and visits of the
    // member it takes out, which the deletion deletes too: the deletion locks
    // the wikis of the account before, so it waits for the removal, rather
    // than hold rows the removal waits for.
    it('takes its turn behind an admin removing it from a wiki', async () => {
      const gone = makeUser()
      const admin = aPeerOf(gone)
      // Their personal wiki keeps them a member, so the deletion finds them by
      // their email even when the removal is done before it starts: another
      // file's ALTER TABLE on wiki_members, as db.test.ts runs, can wait
      // behind the removal, and behindAChange counts it as the deletion.
      await personalWikiOf(api, gone)
      const wiki = await aWiki(admin, 'Roadmap', [[gone, 'editor']])
      await favoriteOpenAndFollow(gone, wiki.homePageId)

      const done = await behindAChange<number | string>(db, admin, wiki.id, [
        async () =>
          (await removeMember(api, admin, wiki.id, gone.userId)).statusCode,
        async () => {
          await deliver(routingKey, body(gone))
          return 'deleted'
        }
      ])

      expect(done).toEqual([204, 'deleted'])
      expect(await membersOf(admin, wiki.id)).toEqual([
        { userId: admin.userId, role: 'admin' }
      ])
      expect(await keptFor(gone)).toEqual(NOTHING_KEPT)
    })

    // As a removal, an invitation locks the wiki, then deletes the invitation
    // emails older than a day, those the account sent among them.
    it('takes its turn behind an admin inviting someone to one of its wikis', async () => {
      const gone = makeUser()
      const admin = aPeerOf(gone)
      const wiki = await aWiki(admin, 'Roadmap', [[gone, 'admin']])
      const newcomer = anEmail('newcomer')
      // Sent by the account two days ago, which no route can backdate.
      await inTenant(db, gone, tx =>
        tx.insert(inviteEmails).values({
          wikiId: wiki.id,
          organizationId: gone.organizationId,
          email: anEmail('third'),
          invitedBy: gone.userId,
          sentAt: new Date(Date.now() - 2 * 24 * 60 * 60_000)
        })
      )

      const done = await behindAChange<number | string>(db, admin, wiki.id, [
        async () =>
          (await invite(api, admin, wiki.id, newcomer, 'viewer')).statusCode,
        async () => {
          await deliver(routingKey, body(gone))
          return 'deleted'
        }
      ])

      expect(done).toEqual([202, 'deleted'])
      expect(await invitationEmailsOf(admin, wiki.id)).toEqual([newcomer])
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

      expect(await pagesVersionsAndCommentsIn(handedOn, editor)).toEqual({
        titles: ['Onboarding'],
        versions: [{ number: 1, authorId: gone.userId }],
        comments: [{ authorId: gone.userId, body: 'Welcome aboard' }]
      })
    })

    it('loses its favorites, recent pages, follows and notifications', async () => {
      const gone = makeUser()
      const editor = aPeerOf(gone)
      // A wiki the person created, once handed on, still shows its pages to them
      // in B2C, so what they kept on those pages can be read as them.
      const handedOn = await aWiki(gone, 'Handbook', [[editor, 'editor']])
      const pageId = await aPageIn(db, editor, handedOn.id, {
        title: 'Onboarding',
        position: 'a0'
      })
      await favoriteOpenAndFollow(gone, pageId)
      await notify(db, editor, handedOn, gone)

      await deliver(routingKey, body(gone))

      expect(await keptFor(gone)).toEqual(NOTHING_KEPT)
    })

    // Those stay when it leaves the wiki, out of its sight in B2C, for when it
    // comes back.
    it('loses its follows and notifications of a wiki it left', async () => {
      const gone = makeUser()
      const admin = aPeerOf(gone)
      // Signed in, so a deletion by email finds it once out of the wiki.
      await wikisOf(api, gone)
      const wiki = await aWiki(admin, 'Roadmap', [[gone, 'editor']])
      const notes = await createPage(api, gone, wiki.id, { title: 'Notes' })
      await notify(db, admin, wiki, gone)
      await removeMember(api, gone, wiki.id, gone.userId)

      await deliver(routingKey, body(gone))

      await backIn(api, admin, gone, wiki.id)
      expect(
        await followingAndUnreadOf(api, gone, wiki.id, notes.json<Page>().id)
      ).toEqual({ following: false, unread: 0 })
    })

    it('leaves the notifications its changes sent to others', async () => {
      const gone = makeUser()
      const editor = aPeerOf(gone)
      const handedOn = await aWiki(gone, 'Handbook', [[editor, 'editor']])
      await notify(db, gone, handedOn, editor)

      await deliver(routingKey, body(gone))

      expect(await sharedWikisOf(editor)).toEqual([
        expect.objectContaining({ name: 'Handbook', unread: 1 })
      ])
    })

    it('loses the invitation emails it sent and received', async () => {
      const gone = makeUser()
      const admin = aPeerOf(gone)
      const wiki = await aWiki(admin, 'Roadmap', [])
      const third = anEmail('third')
      const other = anEmail('other')
      await invite(api, admin, wiki.id, gone.email, 'admin')
      await wikisOf(api, gone)
      await invite(api, gone, wiki.id, third, 'viewer')
      await invite(api, admin, wiki.id, other, 'viewer')
      expect(await invitationEmailsOf(admin, wiki.id)).toEqual([
        gone.email,
        third,
        other
      ])

      await deliver(routingKey, body(gone))

      expect(await invitationEmailsOf(admin, wiki.id)).toEqual([other])
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

      expect((await api.as(gone).get('/settings')).json()).toEqual(NO_SETTINGS)
    })
  }
)

describe.each(deletions.filter(({ matchedBy }) => matchedBy === 'email'))(
  'a deleted account matched by email ($tenant)',
  ({ routingKey, makeUser, body }) => {
    it('is found whatever the case of its email', async () => {
      const gone = { ...makeUser(), email: `Gone-${randomUUID()}@Example.com` }
      const personal = await personalWikiOf(api, gone)

      await deliver(
        routingKey,
        body({ ...gone, email: gone.email.toLowerCase() })
      )

      expect(await wikiRowsOf(db, gone, personal.id)).toEqual([])
    })

    it('loses its Twake Workplace settings, even if it never opened Pages', async () => {
      const gone = { ...makeUser(), email: `Gone-${randomUUID()}@Example.com` }
      await db.transaction(tx =>
        keepSettings(tx, 1, {
          email: gone.email.toLowerCase(),
          display_name: 'Gone'
        })
      )

      await deliver(routingKey, body(gone))

      expect((await api.as(gone).get('/settings')).json()).toEqual(NO_SETTINGS)
    })
  }
)

describe('a deleted account in a space wiki', () => {
  it('leaves the wiki to its space, even as its only admin', async () => {
    const gone = aUser()
    const viewer = aUser({ organizationId: gone.organizationId })
    const wikiId = await aSpaceWiki(db, [
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
    expect(await openingStatus(gone, wikiId)).toBe(404)
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
    // The colleague's favorite and recent page, which only they may see, go
    // with the wiki all the same, as their follow does.
    await favoriteOpenAndFollow(colleague, handbook.homePageId)
    await aSpaceWiki(db, [[colleague, 'admin']])
    const deleted = await aWiki(admin, 'Minutes', [])
    await api.as(admin).delete(`/wikis/${deleted.id}`)
    const outsidersWiki = await aWiki(outsider, 'Minutes', [])
    await api.as(outsider).delete(`/wikis/${outsidersWiki.id}`)
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
    expect(await keptFor(colleague)).toEqual(NOTHING_KEPT)
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

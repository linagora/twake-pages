import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest'
import { createDb } from '../../infra/db.ts'
import {
  aColleagueOf,
  aCommentOn,
  aPage,
  aUser,
  aWikiOf,
  backIn,
  editComment,
  follow,
  joinWiki,
  notificationsOf,
  personOf,
  publish,
  restoreVersion,
  someoneOfEachTenant,
  startApp,
  WAYS_TO_LEAVE,
  waysOutOfAWiki,
  type Notifications
} from '../../testing/app.ts'
import { notify, notifyOfVersions } from './testing.ts'

let api: Awaited<ReturnType<typeof startApp>>
const { sql, db } = createDb(inject('databaseUrl'))

beforeAll(async () => {
  api = await startApp()
})

afterAll(async () => {
  await api.close()
  await sql.end()
})

const nothing = { notifications: [], unread: 0 }

describe('GET /notifications', () => {
  it('lists the person’s notifications newest first, with the page, its wiki and who acted', async () => {
    const alice = { ...aUser(), name: 'Alice Martin' }
    const bob = aColleagueOf(alice, 'bob')
    const wiki = await aWikiOf(api, alice)
    await joinWiki(db, alice, wiki.id, bob, 'editor')
    await notify(db, alice, wiki, bob, new Date())
    await notify(db, alice, wiki, bob)

    const response = await api.as(bob).get('/notifications')

    expect(response.statusCode).toBe(200)
    const { notifications, unread } = response.json<Notifications>()
    expect(notifications).toEqual([
      {
        id: expect.any(String) as string,
        reason: 'published',
        page: { id: wiki.homePageId, title: 'Handbook' },
        wiki: { id: wiki.id, name: 'Handbook', kind: 'shared' },
        actor: personOf(alice),
        version: 2,
        commentId: null,
        createdAt: expect.any(String) as string,
        readAt: null
      },
      expect.objectContaining({ readAt: expect.any(String) as string })
    ])
    expect(unread).toBe(1)
    expect(await notificationsOf(api, alice)).toEqual(nothing)
  })

  it('lists the 100 newest notifications, and counts every unread one', async () => {
    const alice = aUser()
    const bob = aColleagueOf(alice, 'bob')
    const wiki = await aWikiOf(api, alice)
    await joinWiki(db, alice, wiki.id, bob, 'editor')
    // Written at once, at one time: the newest have the greater ids.
    await notifyOfVersions(db, alice, wiki, bob, 101)

    const { notifications, unread } = await notificationsOf(api, bob)

    expect(notifications.map(each => each.version)).toEqual(
      Array.from({ length: 100 }, (_, index) => 102 - index)
    )
    expect(unread).toBe(101)
  })

  it.each(waysOutOfAWiki)(
    'leaves out the notifications of %s',
    async (_case, someone, takeOut) => {
      const alice = someone()
      const bob = aColleagueOf(alice, 'bob')
      const wiki = await aWikiOf(api, alice)
      await joinWiki(db, alice, wiki.id, bob, 'editor')
      await notify(db, alice, wiki, bob)

      await takeOut(api, alice, wiki.id, bob)

      expect(await notificationsOf(api, bob)).toEqual(nothing)
    }
  )

  describe.each(someoneOfEachTenant)(
    'of a member back in a wiki, %s',
    (_tenant, someone) => {
      it.each(WAYS_TO_LEAVE)(
        'lists the notifications of the wiki they left, %s',
        async (_case, leave) => {
          const alice = someone()
          const bob = aColleagueOf(alice, 'bob')
          const wiki = await aWikiOf(api, alice)
          await joinWiki(db, alice, wiki.id, bob, 'editor')
          await notify(db, alice, wiki, bob)
          await leave(api, alice, wiki.id, bob)

          await backIn(api, alice, bob, wiki.id)

          expect(await notificationsOf(api, bob)).toMatchObject({
            notifications: [{ wiki: { id: wiki.id }, version: 2 }],
            unread: 1
          })
        }
      )
    }
  )
})

describe('publishing', () => {
  const draft = (baseVersion: number, title = 'Onboarding') => ({
    baseVersion,
    title,
    content: []
  })

  it('tells the page’s followers of a new version, never its author', async () => {
    const alice = { ...aUser(), name: 'Alice Martin' }
    const bob = aColleagueOf(alice, 'bob')
    const wiki = await aWikiOf(api, alice)
    await joinWiki(db, alice, wiki.id, bob, 'editor')
    const page = await aPage(api, alice, wiki.id, { title: 'Onboarding' })
    await follow(api, bob, page)

    // Version 1 told no one.
    expect(await notificationsOf(api, bob)).toEqual(nothing)

    await publish(api, alice, page, draft(1))

    const { notifications, unread } = await notificationsOf(api, bob)
    expect(notifications).toEqual([
      {
        id: expect.any(String) as string,
        reason: 'published',
        page: { id: page, title: 'Onboarding' },
        wiki: { id: wiki.id, name: 'Handbook', kind: 'shared' },
        actor: personOf(alice),
        version: 2,
        commentId: null,
        createdAt: expect.any(String) as string,
        readAt: null
      }
    ])
    expect(unread).toBe(1)
    expect(await notificationsOf(api, alice)).toEqual(nothing)
    // A member who follows nothing is told nothing.
    const carol = aColleagueOf(alice, 'carol')
    await joinWiki(db, alice, wiki.id, carol, 'viewer')
    await publish(api, alice, page, draft(2))
    expect(await notificationsOf(api, carol)).toEqual(nothing)
  })

  it('tells the followers again when a version is restored', async () => {
    const alice = aUser()
    const bob = aColleagueOf(alice, 'bob')
    const wiki = await aWikiOf(api, alice)
    await joinWiki(db, alice, wiki.id, bob, 'editor')
    const page = await aPage(api, alice, wiki.id, { title: 'Onboarding' })
    await follow(api, bob, page)
    await publish(api, alice, page, draft(1))

    await restoreVersion(api, alice, page, 1)

    const listed = await notificationsOf(api, bob)
    expect(listed.notifications).toMatchObject([
      { reason: 'published', version: 3 },
      { reason: 'published', version: 2 }
    ])
    expect(listed.unread).toBe(2)
  })

  it.each(WAYS_TO_LEAVE)(
    'tells a follower who left %s nothing while they are out',
    async (_case, takeOut) => {
      const alice = aUser()
      const bob = aColleagueOf(alice, 'bob')
      const wiki = await aWikiOf(api, alice)
      await joinWiki(db, alice, wiki.id, bob, 'editor')
      const page = await aPage(api, alice, wiki.id, { title: 'Onboarding' })
      await follow(api, bob, page)

      await takeOut(api, alice, wiki.id, bob)
      await publish(api, alice, page, draft(1))
      await publish(api, alice, page, draft(2))

      // No row was written while they were out, so they are told nothing
      // once back either: a left wiki keeps their follows and notifications,
      // not the versions published while they were away.
      expect(await notificationsOf(api, bob)).toEqual(nothing)
      await backIn(api, alice, bob, wiki.id)
      expect(await notificationsOf(api, bob)).toEqual(nothing)
    }
  )
})

describe('commenting', () => {
  /** A wiki with bob, carol and dan as members, all editors, and a page. */
  async function aWikiWithThree() {
    const alice = aUser()
    const bob = aColleagueOf(alice, 'bob')
    const carol = aColleagueOf(alice, 'carol')
    const dan = aColleagueOf(alice, 'dan')
    const wiki = await aWikiOf(api, alice)
    await joinWiki(db, alice, wiki.id, bob, 'editor')
    await joinWiki(db, alice, wiki.id, carol, 'editor')
    await joinWiki(db, alice, wiki.id, dan, 'editor')
    const page = await aPage(api, alice, wiki.id, { title: 'Onboarding' })
    return { alice, bob, carol, dan, wiki, page }
  }

  it('tells the members a comment mentions, the page’s other followers, never its author', async () => {
    const { alice, bob, carol, page } = await aWikiWithThree()
    await follow(api, carol, page)

    const comment = await aCommentOn(api, bob, page, {
      body: `@${alice.email}, can you review?`
    })

    expect(await notificationsOf(api, alice)).toMatchObject({
      notifications: [
        { reason: 'mentioned', commentId: comment.id, actor: personOf(bob) }
      ],
      unread: 1
    })
    // The page's other follower, told `commented`, not `mentioned`.
    expect((await notificationsOf(api, carol)).notifications).toMatchObject([
      { reason: 'commented', commentId: comment.id }
    ])
    // The author is never told.
    expect(await notificationsOf(api, bob)).toEqual(nothing)
  })

  it('tells a reply as a comment, and never the person it mentions twice', async () => {
    const { alice, bob, carol, page } = await aWikiWithThree()
    await follow(api, carol, page)
    const comment = await aCommentOn(api, bob, page, { body: 'Draft ready' })

    await aCommentOn(api, alice, page, {
      body: `@${carol.email}, a reply`,
      parentId: comment.id
    })

    // carol is told `mentioned` for the reply, and `commented` for the first
    // comment she follows: a reply tells as a comment does.
    expect((await notificationsOf(api, carol)).notifications).toMatchObject([
      { reason: 'mentioned', actor: personOf(alice) },
      { reason: 'commented', actor: personOf(bob) }
    ])
  })

  it('tells an edit’s new mention once, and never one it made before', async () => {
    const { bob, carol, page } = await aWikiWithThree()
    const comment = await aCommentOn(api, bob, page, { body: 'Draft ready' })

    await editComment(api, bob, comment.id, {
      body: `@${carol.email}, draft ready`
    })
    await editComment(api, bob, comment.id, {
      body: `@${carol.email}, @${bob.email}, draft ready`
    })

    expect((await notificationsOf(api, carol)).notifications).toMatchObject([
      { reason: 'mentioned', commentId: comment.id }
    ])
    // An edit tells only the members it mentions anew: bob is its author, and
    // is never told, not even of his own mention.
    expect(await notificationsOf(api, bob)).toEqual(nothing)
    // A second edit mentioning carol again tells her nothing more.
    await editComment(api, bob, comment.id, {
      body: `@${carol.email}, once more`
    })
    expect((await notificationsOf(api, carol)).notifications).toHaveLength(1)
  })

  it('tells a mentioned member out of the wiki nothing', async () => {
    const { alice, bob, carol, wiki, page } = await aWikiWithThree()
    await api.as(alice).delete(`/wikis/${wiki.id}/members/${carol.userId}`)

    await aCommentOn(api, bob, page, { body: `@${carol.email}, hi` })

    expect(await notificationsOf(api, carol)).toEqual(nothing)
  })

  it('tells a mention to a member of each tenant', async () => {
    for (const [, someone] of someoneOfEachTenant) {
      const alice = someone()
      const bob = aColleagueOf(alice, 'bob')
      const wiki = await aWikiOf(api, alice)
      await joinWiki(db, alice, wiki.id, bob, 'editor')
      const page = await aPage(api, alice, wiki.id, { title: 'Onboarding' })

      await aCommentOn(api, alice, page, { body: `@${bob.email}, hi` })

      expect((await notificationsOf(api, bob)).notifications).toMatchObject([
        { reason: 'mentioned', page: { id: page } }
      ])
    }
  })

  it('keeps a mention apart from the published notifications of the same page', async () => {
    const { bob, carol, page } = await aWikiWithThree()
    await follow(api, carol, page)
    await publish(api, bob, page, {
      baseVersion: 1,
      title: 'Onboarding',
      content: []
    })
    await aCommentOn(api, bob, page, { body: `@${carol.email}, hi` })

    // Newest first: the mention of the comment, then the version 2 publish,
    // the two reasons of the same page and actor.
    expect((await notificationsOf(api, carol)).notifications).toMatchObject([
      { reason: 'mentioned', commentId: expect.any(String) as string },
      { reason: 'published', version: 2 }
    ])
  })
})

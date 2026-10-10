import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest'
import { createDb } from '../../infra/db.ts'
import {
  aColleagueOf,
  aUser,
  aWikiOf,
  backIn,
  joinWiki,
  notificationsOf,
  personOf,
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

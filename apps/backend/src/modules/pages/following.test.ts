import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest'
import { createDb } from '../../infra/db.ts'
import {
  aColleagueOf,
  aPageIn,
  aUser,
  aWikiOf,
  backIn,
  joinWiki,
  malformedOrUnknownIds,
  pageOf,
  someoneOfEachTenant,
  startApp,
  versionOf,
  WAYS_TO_LEAVE,
  waysOutOfAWiki,
  type TestUser
} from '../../testing/app.ts'

let api: Awaited<ReturnType<typeof startApp>>
const { sql, db } = createDb(inject('databaseUrl'))

beforeAll(async () => {
  api = await startApp()
})

afterAll(async () => {
  await api.close()
  await sql.end()
})

const follow = (user: TestUser, pageId: string) =>
  api.as(user).put(`/pages/${pageId}/follow`)

const unfollow = (user: TestUser, pageId: string) =>
  api.as(user).delete(`/pages/${pageId}/follow`)

/** Whether the person follows the page, as `GET /pages/:pageId` tells them. */
const isFollowing = async (user: TestUser, pageId: string) =>
  (await pageOf(api, user, pageId)).following

describe('PUT and DELETE /pages/:pageId/follow', () => {
  it.each(someoneOfEachTenant)(
    'lets a viewer %s follow a page, until they stop',
    async (_case, someone) => {
      const alice = someone()
      const bob = aColleagueOf(alice, 'bob')
      const wiki = await aWikiOf(api, alice)
      await joinWiki(db, alice, wiki.id, bob, 'viewer')

      const followed = await follow(bob, wiki.homePageId)
      const following = await isFollowing(bob, wiki.homePageId)
      const stopped = await unfollow(bob, wiki.homePageId)

      expect([followed, stopped].map(response => response.statusCode)).toEqual([
        204, 204
      ])
      expect({
        following,
        left: await isFollowing(bob, wiki.homePageId)
      }).toEqual({ following: true, left: false })
    }
  )

  it.each(someoneOfEachTenant)(
    'leaves the others following when a member %s stops',
    async (_case, someone) => {
      const alice = someone()
      const bob = aColleagueOf(alice, 'bob')
      const wiki = await aWikiOf(api, alice)
      await joinWiki(db, alice, wiki.id, bob, 'viewer')
      await follow(bob, wiki.homePageId)

      await unfollow(bob, wiki.homePageId)

      expect({
        alice: await isFollowing(alice, wiki.homePageId),
        bob: await isFollowing(bob, wiki.homePageId)
      }).toEqual({ alice: true, bob: false })
    }
  )

  it('keeps following a page followed again', async () => {
    const alice = aUser()
    const wiki = await aWikiOf(api, alice)

    const again = await follow(alice, wiki.homePageId)

    expect(again.statusCode).toBe(204)
    expect(await isFollowing(alice, wiki.homePageId)).toBe(true)
  })

  // As a page opens from the trash, which keeps it until it is restored.
  it('lets a member follow a page in the trash, and stop', async () => {
    const alice = aUser()
    const wiki = await aWikiOf(api, alice)
    const drafts = await aPageIn(db, alice, wiki.id, {
      title: 'Drafts',
      position: 'a0',
      deleted: true
    })

    const followed = await follow(alice, drafts)
    const following = await isFollowing(alice, drafts)
    const stopped = await unfollow(alice, drafts)

    expect([followed, stopped].map(response => response.statusCode)).toEqual([
      204, 204
    ])
    expect({ following, left: await isFollowing(alice, drafts) }).toEqual({
      following: true,
      left: false
    })
  })

  // Nothing the wiki shows its members changes, as for a favorite.
  it('moves no version of the wiki', async () => {
    const alice = aUser()
    const wiki = await aWikiOf(api, alice)
    const before = await versionOf(api, alice, wiki.id)

    await unfollow(alice, wiki.homePageId)
    await follow(alice, wiki.homePageId)

    expect(await versionOf(api, alice, wiki.id)).toBe(before)
  })

  it('answers not_found to someone who is no member following a page, and makes them no follower', async () => {
    const alice = aUser()
    const bob = aColleagueOf(alice, 'bob')
    const wiki = await aWikiOf(api, alice)
    const before = await versionOf(api, alice, wiki.id)

    const response = await follow(bob, wiki.homePageId)
    await joinWiki(db, alice, wiki.id, bob, 'viewer')

    expect(response.statusCode).toBe(404)
    expect(response.json()).toEqual({ error: 'not_found' })
    expect(await isFollowing(bob, wiki.homePageId)).toBe(false)
    expect(await versionOf(api, alice, wiki.id)).toBe(before)
  })

  it.each(WAYS_TO_LEAVE)(
    'answers not_found to a member who left %s stopping following a page, which they follow again once back',
    async (_case, takeOut) => {
      const alice = aUser()
      const bob = aColleagueOf(alice, 'bob')
      const wiki = await aWikiOf(api, alice)
      await joinWiki(db, alice, wiki.id, bob, 'viewer')
      await follow(bob, wiki.homePageId)
      await takeOut(api, alice, wiki.id, bob)
      const before = await versionOf(api, alice, wiki.id)

      const response = await unfollow(bob, wiki.homePageId)
      const after = await versionOf(api, alice, wiki.id)
      await backIn(api, alice, bob, wiki.id)

      expect(response.statusCode).toBe(404)
      expect(response.json()).toEqual({ error: 'not_found' })
      expect(after).toBe(before)
      expect(await isFollowing(bob, wiki.homePageId)).toBe(true)
    }
  )

  it.each(waysOutOfAWiki)(
    'answers not_found for a page of %s',
    async (_case, someone, takeOut) => {
      const alice = someone()
      const carol = aColleagueOf(alice, 'carol')
      const wiki = await aWikiOf(api, carol)
      await joinWiki(db, carol, wiki.id, alice, 'viewer')
      await takeOut(api, carol, wiki.id, alice)

      const responses = [
        await follow(alice, wiki.homePageId),
        await unfollow(alice, wiki.homePageId)
      ]

      expect(responses.map(response => response.statusCode)).toEqual([404, 404])
      expect(responses.map(response => response.json<unknown>())).toEqual([
        { error: 'not_found' },
        { error: 'not_found' }
      ])
    }
  )

  it.each(malformedOrUnknownIds)(
    'answers not_found for a page with %s',
    async (_case, pageId) => {
      const alice = aUser()

      const responses = [
        await follow(alice, pageId),
        await unfollow(alice, pageId)
      ]

      expect(responses.map(response => response.statusCode)).toEqual([404, 404])
      expect(responses.map(response => response.json<unknown>())).toEqual([
        { error: 'not_found' },
        { error: 'not_found' }
      ])
    }
  )
})

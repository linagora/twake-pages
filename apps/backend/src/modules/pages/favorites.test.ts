import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest'
import { createDb } from '../../infra/db.ts'
import {
  aPageIn,
  aUser,
  aWikiOf,
  joinWiki,
  startApp,
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

const mark = (user: TestUser, pageId: string) =>
  api.as(user).put(`/pages/${pageId}/favorite`)

const unmark = (user: TestUser, pageId: string) =>
  api.as(user).delete(`/pages/${pageId}/favorite`)

/** Whether the person marked the page, as `GET /pages/:pageId` tells them. */
const isFavorite = async (user: TestUser, pageId: string) =>
  (await api.as(user).get(`/pages/${pageId}`)).json<{ favorite: boolean }>()
    .favorite

describe('PUT and DELETE /pages/:pageId/favorite', () => {
  it('marks a page as a favorite of the person, until unmarked', async () => {
    const alice = aUser()
    const wiki = await aWikiOf(api, alice)

    const marked = await mark(alice, wiki.homePageId)
    const kept = await isFavorite(alice, wiki.homePageId)
    const unmarked = await unmark(alice, wiki.homePageId)

    expect([marked, unmarked].map(response => response.statusCode)).toEqual([
      204, 204
    ])
    expect({ kept, left: await isFavorite(alice, wiki.homePageId) }).toEqual({
      kept: true,
      left: false
    })
  })

  it('keeps a page marked again as a favorite', async () => {
    const alice = aUser()
    const wiki = await aWikiOf(api, alice)
    await mark(alice, wiki.homePageId)

    const again = await mark(alice, wiki.homePageId)

    expect(again.statusCode).toBe(204)
    expect(await isFavorite(alice, wiki.homePageId)).toBe(true)
  })

  it('lets a viewer mark a page, for themself alone', async () => {
    const alice = aUser()
    const bob = aUser({ organizationId: alice.organizationId })
    const wiki = await aWikiOf(api, alice)
    await joinWiki(db, alice, wiki.id, bob, 'viewer')

    const response = await mark(bob, wiki.homePageId)

    expect(response.statusCode).toBe(204)
    expect({
      bob: await isFavorite(bob, wiki.homePageId),
      alice: await isFavorite(alice, wiki.homePageId)
    }).toEqual({ bob: true, alice: false })
  })

  // As a page opens from the trash, which keeps it until it is restored.
  it('marks a page in the trash', async () => {
    const alice = aUser()
    const wiki = await aWikiOf(api, alice)
    const drafts = await aPageIn(db, alice, wiki.id, {
      title: 'Drafts',
      position: 'a0',
      deleted: true
    })

    const response = await mark(alice, drafts)

    expect(response.statusCode).toBe(204)
    expect(await isFavorite(alice, drafts)).toBe(true)
  })

  it.each([
    ['marking', mark],
    ['unmarking', unmark]
  ])(
    'answers not_found to someone who is no member %s a page, and keeps nothing for them',
    async (_case, send) => {
      const alice = aUser()
      const bob = aUser({ organizationId: alice.organizationId })
      const wiki = await aWikiOf(api, alice)

      const response = await send(bob, wiki.homePageId)
      await joinWiki(db, alice, wiki.id, bob, 'viewer')

      expect(response.statusCode).toBe(404)
      expect(response.json()).toEqual({ error: 'not_found' })
      expect(await isFavorite(bob, wiki.homePageId)).toBe(false)
    }
  )

  it.each([
    ['a malformed id', 'not-an-id'],
    ['an unknown id', randomUUID()]
  ])('answers not_found for a page with %s', async (_case, pageId) => {
    const response = await mark(aUser(), pageId)

    expect(response.statusCode).toBe(404)
    expect(response.json()).toEqual({ error: 'not_found' })
  })
})

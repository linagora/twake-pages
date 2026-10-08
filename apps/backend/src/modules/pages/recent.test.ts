import { generateNKeysBetween } from 'fractional-indexing'
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest'
import { createDb } from '../../infra/db.ts'
import {
  aPageIn,
  aUser,
  aWikiOf,
  createPage,
  joinWiki,
  personalWikiOf,
  startApp,
  waysOutOfAWiki,
  type RecentPage,
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

const recentOf = async (user: TestUser) =>
  (await api.as(user).get('/recent')).json<{ pages: RecentPage[] }>().pages

const idsOf = (pages: RecentPage[]) => pages.map(page => page.id)

const open = (user: TestUser, pageId: string) =>
  api.as(user).get(`/pages/${pageId}`)

/** Pages of the wiki, made at once, that the person opens one after the other. */
const openedInTurn = async (user: TestUser, wikiId: string, count: number) => {
  const opened = await Promise.all(
    generateNKeysBetween(null, null, count).map(position =>
      aPageIn(db, user, wikiId, { title: position, position })
    )
  )
  for (const pageId of opened) await open(user, pageId)
  return opened
}

describe('recent pages', () => {
  it('lists the pages the person opened, with their wiki, the last one first, with when', async () => {
    const alice = aUser()
    const wiki = await aWikiOf(api, alice, 'Handbook')
    const plans = (
      await createPage(api, alice, wiki.id, { title: 'Plans' })
    ).json<{ id: string }>().id
    await open(alice, wiki.homePageId)
    await open(alice, plans)
    await open(alice, wiki.homePageId)

    const recent = await recentOf(alice)

    const handbook = { id: wiki.id, name: 'Handbook', kind: 'shared' }
    expect(recent).toEqual([
      {
        id: wiki.homePageId,
        title: 'Handbook',
        wiki: handbook,
        visitedAt: expect.any(String) as string
      },
      {
        id: plans,
        title: 'Plans',
        wiki: handbook,
        visitedAt: expect.any(String) as string
      }
    ])
    // The home page, made first, was opened last.
    const times = recent.map(page => Date.parse(page.visitedAt))
    expect(times).toEqual([...times].sort((a, b) => b - a))
  })

  it('lists none of the pages others opened', async () => {
    const alice = aUser()
    const bob = aUser({ organizationId: alice.organizationId })
    const wiki = await aWikiOf(api, alice)
    await joinWiki(db, alice, wiki.id, bob, 'viewer')
    const plans = await aPageIn(db, alice, wiki.id, {
      title: 'Plans',
      position: 'a0'
    })
    await open(alice, plans)

    await open(bob, wiki.homePageId)

    expect(idsOf(await recentOf(alice))).toEqual([plans])
  })

  it('lists the 20 pages the person opened last', async () => {
    const alice = aUser()
    const wiki = await aWikiOf(api, alice)
    const opened = await openedInTurn(alice, wiki.id, 21)

    const recent = await recentOf(alice)

    expect(idsOf(recent)).toEqual(opened.slice(1).reverse())
  })

  it('lists no page in the trash, nor counts it among the 20', async () => {
    const alice = aUser()
    const wiki = await aWikiOf(api, alice)
    const drafts = await aPageIn(db, alice, wiki.id, {
      title: 'Drafts',
      position: 'a0',
      deleted: true
    })
    const opened = await openedInTurn(alice, wiki.id, 20)

    await open(alice, drafts)

    expect(idsOf(await recentOf(alice))).toEqual(opened.reverse())
  })

  it.each(waysOutOfAWiki)(
    'lists no page of %s',
    async (_case, someone, takeOut) => {
      const alice = someone()
      const carol = aUser({ organizationId: alice.organizationId })
      const personal = await personalWikiOf(api, alice)
      const wiki = await aWikiOf(api, carol)
      await joinWiki(db, carol, wiki.id, alice, 'viewer')
      await open(alice, wiki.homePageId)
      await open(alice, personal.homePageId)
      expect(idsOf(await recentOf(alice))).toEqual([
        personal.homePageId,
        wiki.homePageId
      ])

      await takeOut(api, db, carol, wiki.id, alice)

      expect(idsOf(await recentOf(alice))).toEqual([personal.homePageId])
    }
  )
})

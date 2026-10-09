import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest'
import { createDb } from '../../infra/db.ts'
import {
  aPage,
  aPageIn,
  aUser,
  aWikiOf,
  createPage,
  deletePage,
  joinWiki,
  malformedOrUnknownIds,
  pageOf,
  someoneOfEachTenant,
  startApp,
  titlesUnder,
  versionOf,
  waysOutOfAWiki,
  wikiRowsOf
} from '../../testing/app.ts'
import { behindAChange } from '../wikis/testing.ts'

let api: Awaited<ReturnType<typeof startApp>>
const { sql, db } = createDb(inject('databaseUrl'))

beforeAll(async () => {
  api = await startApp()
})

afterAll(async () => {
  await api.close()
  await sql.end()
})

describe('DELETE /pages/:pageId', () => {
  it.each(someoneOfEachTenant)(
    'puts the page in the trash with its child pages, %s',
    async (_case, someone) => {
      const alice = someone()
      const wiki = await aWikiOf(api, alice)
      const onboarding = await aPage(api, alice, wiki.id, {
        title: 'Onboarding'
      })
      const laptop = await aPage(api, alice, wiki.id, {
        title: 'Laptop setup',
        parentId: onboarding
      })
      const accounts = await aPage(api, alice, wiki.id, {
        title: 'Accounts',
        parentId: laptop
      })
      const releases = await aPage(api, alice, wiki.id, { title: 'Releases' })

      const response = await deletePage(api, alice, onboarding)

      expect(response.statusCode).toBe(204)
      expect(response.body).toBe('')
      expect(await titlesUnder(api, alice, wiki.id, null)).toEqual(['Releases'])
      const { deletedAt } = await pageOf(api, alice, onboarding)
      expect(deletedAt).toEqual(expect.any(String) as string)
      expect((await pageOf(api, alice, laptop)).deletedAt).toBe(deletedAt)
      expect((await pageOf(api, alice, accounts)).deletedAt).toBe(deletedAt)
      expect((await pageOf(api, alice, releases)).deletedAt).toBeNull()
    }
  )

  it('leaves a child page deleted before in its own branch', async () => {
    const alice = aUser()
    const wiki = await aWikiOf(api, alice)
    const onboarding = await aPage(api, alice, wiki.id, { title: 'Onboarding' })
    const laptop = await aPage(api, alice, wiki.id, {
      title: 'Laptop setup',
      parentId: onboarding
    })
    await deletePage(api, alice, laptop)
    const { deletedAt } = await pageOf(api, alice, laptop)

    await deletePage(api, alice, onboarding)

    expect((await pageOf(api, alice, laptop)).deletedAt).toBe(deletedAt)
  })

  it('moves the wiki’s version, so every open tree shows the page gone', async () => {
    const alice = aUser()
    const wiki = await aWikiOf(api, alice)
    const onboarding = await aPage(api, alice, wiki.id, { title: 'Onboarding' })
    const before = await versionOf(api, alice, wiki.id)

    await deletePage(api, alice, onboarding)

    expect(await versionOf(api, alice, wiki.id)).toBe(before + 1)
  })

  it('answers home_page for the home page', async () => {
    const alice = aUser()
    const wiki = await aWikiOf(api, alice)
    const before = await versionOf(api, alice, wiki.id)

    const response = await deletePage(api, alice, wiki.homePageId)

    expect(response.statusCode).toBe(409)
    expect(response.json()).toEqual({ error: 'home_page' })
    expect(await versionOf(api, alice, wiki.id)).toBe(before)
    expect((await pageOf(api, alice, wiki.homePageId)).deletedAt).toBeNull()
  })

  // Each request waits for the wiki's row lock, which the change holds, then
  // reads the tree as the request before it left it.
  it('takes along a child page created while it waits its turn', async () => {
    const alice = aUser()
    const bob = aUser({ organizationId: alice.organizationId })
    const wiki = await aWikiOf(api, alice)
    await joinWiki(db, alice, wiki.id, bob, 'editor')
    const onboarding = await aPage(api, alice, wiki.id, { title: 'Onboarding' })

    const [created, deleted] = await behindAChange(db, alice, wiki.id, [
      () =>
        createPage(api, bob, wiki.id, {
          title: 'Laptop setup',
          parentId: onboarding
        }),
      () => deletePage(api, alice, onboarding)
    ])

    expect(created?.statusCode).toBe(201)
    expect(deleted?.statusCode).toBe(204)
    expect(deleted?.body).toBe('')
    const laptop = created?.json<{ id: string }>().id ?? ''
    const { deletedAt } = await pageOf(api, alice, onboarding)
    expect((await pageOf(api, alice, laptop)).deletedAt).toBe(deletedAt)
    expect(await titlesUnder(api, alice, wiki.id, null)).toEqual([])
  })

  it('answers in_trash to the later of two deletes that cross', async () => {
    const alice = aUser()
    const bob = aUser({ organizationId: alice.organizationId })
    const wiki = await aWikiOf(api, alice)
    await joinWiki(db, alice, wiki.id, bob, 'editor')
    const onboarding = await aPage(api, alice, wiki.id, { title: 'Onboarding' })
    const laptop = await aPage(api, alice, wiki.id, {
      title: 'Laptop setup',
      parentId: onboarding
    })
    const before = await versionOf(api, alice, wiki.id)

    const [first, second] = await behindAChange(db, alice, wiki.id, [
      () => deletePage(api, alice, onboarding),
      () => deletePage(api, bob, laptop)
    ])

    expect(first?.statusCode).toBe(204)
    expect(second?.statusCode).toBe(409)
    expect(second?.json()).toEqual({ error: 'in_trash' })
    // Moved by the first delete, never by the refused one.
    expect(await versionOf(api, alice, wiki.id)).toBe(before + 1)
    const { deletedAt } = await pageOf(api, alice, onboarding)
    expect((await pageOf(api, alice, laptop)).deletedAt).toBe(deletedAt)
  })

  it('answers in_trash for a page in the trash', async () => {
    const alice = aUser()
    const wiki = await aWikiOf(api, alice)
    const drafts = await aPageIn(db, alice, wiki.id, {
      title: 'Drafts',
      position: 'a0',
      deleted: true
    })
    const before = await versionOf(api, alice, wiki.id)

    const response = await deletePage(api, alice, drafts)

    expect(response.statusCode).toBe(409)
    expect(response.json()).toEqual({ error: 'in_trash' })
    expect(await versionOf(api, alice, wiki.id)).toBe(before)
  })

  it('lets an editor of the wiki delete a page', async () => {
    const alice = aUser()
    const bob = aUser({ organizationId: alice.organizationId })
    const wiki = await aWikiOf(api, alice)
    await joinWiki(db, alice, wiki.id, bob, 'editor')
    const onboarding = await aPage(api, alice, wiki.id, { title: 'Onboarding' })

    const response = await deletePage(api, bob, onboarding)

    expect(response.statusCode).toBe(204)
    expect(await titlesUnder(api, alice, wiki.id, null)).toEqual([])
  })

  it('answers forbidden to a viewer of the wiki', async () => {
    const alice = aUser()
    const bob = aUser({ organizationId: alice.organizationId })
    const wiki = await aWikiOf(api, alice)
    await joinWiki(db, alice, wiki.id, bob, 'viewer')
    const onboarding = await aPage(api, alice, wiki.id, { title: 'Onboarding' })
    const before = await versionOf(api, alice, wiki.id)

    const response = await deletePage(api, bob, onboarding)

    expect(response.statusCode).toBe(403)
    expect(response.json()).toEqual({ error: 'forbidden' })
    expect(await versionOf(api, alice, wiki.id)).toBe(before)
    expect(await titlesUnder(api, alice, wiki.id, null)).toEqual(['Onboarding'])
  })

  // The person's role is checked before the page.
  it('answers forbidden to a viewer deleting the home page', async () => {
    const alice = aUser()
    const bob = aUser({ organizationId: alice.organizationId })
    const wiki = await aWikiOf(api, alice)
    await joinWiki(db, alice, wiki.id, bob, 'viewer')
    const before = await versionOf(api, alice, wiki.id)

    const response = await deletePage(api, bob, wiki.homePageId)

    expect(response.statusCode).toBe(403)
    expect(response.json()).toEqual({ error: 'forbidden' })
    expect(await versionOf(api, alice, wiki.id)).toBe(before)
  })

  it('answers not_found to someone who is no member', async () => {
    const alice = aUser()
    const outsider = aUser({ organizationId: alice.organizationId })
    const wiki = await aWikiOf(api, alice)
    const onboarding = await aPage(api, alice, wiki.id, { title: 'Onboarding' })
    const before = await versionOf(api, alice, wiki.id)

    const response = await deletePage(api, outsider, onboarding)

    expect(response.statusCode).toBe(404)
    expect(response.json()).toEqual({ error: 'not_found' })
    expect(await versionOf(api, alice, wiki.id)).toBe(before)
  })

  // No route shows a deleted wiki's version, so it is read from its row.
  it.each(waysOutOfAWiki)(
    'answers not_found for %s',
    async (_case, someone, takeOut) => {
      const alice = someone()
      const carol = aUser({ organizationId: alice.organizationId })
      const wiki = await aWikiOf(api, carol)
      await joinWiki(db, carol, wiki.id, alice, 'editor')
      const onboarding = await aPage(api, carol, wiki.id, {
        title: 'Onboarding'
      })
      await takeOut(api, carol, wiki.id, alice)
      const before = await wikiRowsOf(db, carol, wiki.id)

      const response = await deletePage(api, alice, onboarding)

      expect(response.statusCode).toBe(404)
      expect(response.json()).toEqual({ error: 'not_found' })
      expect(await wikiRowsOf(db, carol, wiki.id)).toEqual(before)
    }
  )

  it.each(malformedOrUnknownIds)(
    'answers not_found for a page with %s',
    async (_case, pageId) => {
      const response = await deletePage(api, aUser(), pageId)

      expect(response.statusCode).toBe(404)
      expect(response.json()).toEqual({ error: 'not_found' })
    }
  )
})

import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest'
import { createDb, inTenant } from '../../infra/db.ts'
import {
  aB2cUser,
  aPage,
  aPageIn,
  aSpaceWiki,
  aUser,
  aWikiOf,
  createPage,
  deletePage,
  jobOf,
  joinWiki,
  labelNamesIn,
  malformedOrUnknownIds,
  pageOf,
  personOf,
  placeOf,
  removeFromWiki,
  removeMember,
  restorePage,
  setLabels,
  someoneOfEachTenant,
  startApp,
  titlesUnder,
  versionOf,
  waysOutOfAWiki,
  wikiRowsOf,
  type Person,
  type TestUser
} from '../../testing/app.ts'
import { behindAChange, deliverAccountEvent } from '../wikis/testing.ts'
import { pages } from './schema.ts'
import { PURGE_PAGE_JOB, purgePage } from './trash.ts'

let api: Awaited<ReturnType<typeof startApp>>
const { sql, db } = createDb(inject('databaseUrl'))

beforeAll(async () => {
  api = await startApp()
})

afterAll(async () => {
  await api.close()
  await sql.end()
})

/** A deleted branch, as the trash lists it. */
interface TrashEntry {
  id: string
  title: string
  deletedAt: string
  deletedBy: Person
  descendants: number
}

/** The wiki's trash, as `GET /wikis/:wikiId/trash` lists it to the person. */
const trashOf = async (user: TestUser, wikiId: string) =>
  (await api.as(user).get(`/wikis/${wikiId}/trash`)).json<{
    pages: TrashEntry[]
  }>().pages

/** The job planned to purge the deleted branch, by its root, or none. */
const purgeJobOfBranch = (rootId: string) =>
  jobOf(db, `${PURGE_PAGE_JOB}:${rootId}`)

/** Runs the purge the job plans, as the scheduler does once it is due. */
async function runPurge(job: { payload: unknown } | undefined) {
  if (!job) throw new Error('no purge job')
  return db.transaction(tx => purgePage(job.payload, tx))
}

/** Runs the purge of the branch, as the scheduler does once it is due. */
const purgeWhenDue = async (rootId: string) =>
  runPurge(await purgeJobOfBranch(rootId))

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

  it('plans the purge of the branch 30 days later', async () => {
    const alice = aUser()
    const wiki = await aWikiOf(api, alice)
    const onboarding = await aPage(api, alice, wiki.id, { title: 'Onboarding' })

    await deletePage(api, alice, onboarding)

    const job = await purgeJobOfBranch(onboarding)
    const days = ((job?.runAt.getTime() ?? 0) - Date.now()) / 86_400_000
    expect(Math.round(days)).toBe(30)
    // An organization's deletion drops the jobs whose payload names it.
    expect(job?.payload).toHaveProperty('organizationId', alice.organizationId)
  })

  // The page's job is dropped before the wiki's row lock is taken: the
  // refusal rolls it back.
  it('keeps the purge of a branch it refuses to delete again', async () => {
    const alice = aUser()
    const wiki = await aWikiOf(api, alice)
    const onboarding = await aPage(api, alice, wiki.id, { title: 'Onboarding' })
    await deletePage(api, alice, onboarding)
    const job = await purgeJobOfBranch(onboarding)

    await deletePage(api, alice, onboarding)

    expect(await purgeJobOfBranch(onboarding)).toEqual(job)
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

  // A restore sent while the page is live finds no job to drop, then waits
  // behind the page's delete: it leaves that delete's job. A restore sent as
  // the page is deleted again then waits behind that delete for the job's
  // row, which the delete takes before the wiki's.
  it('lets a restore that crosses it bring the page back, though a job was left for the page', async () => {
    const alice = aUser()
    const bob = aUser({ organizationId: alice.organizationId })
    const wiki = await aWikiOf(api, alice)
    await joinWiki(db, alice, wiki.id, bob, 'editor')
    const onboarding = await aPage(api, alice, wiki.id, { title: 'Onboarding' })
    await behindAChange(db, alice, wiki.id, [
      () => deletePage(api, alice, onboarding),
      () => restorePage(api, bob, onboarding)
    ])

    const [deleted, restored] = await behindAChange(db, alice, wiki.id, [
      () => deletePage(api, alice, onboarding),
      () => restorePage(api, bob, onboarding)
    ])

    expect(deleted?.statusCode).toBe(204)
    expect(restored?.statusCode).toBe(200)
    expect(restored?.json()).toEqual(
      await placeOf(api, alice, wiki.id, onboarding)
    )
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

describe('GET /wikis/:wikiId/trash', () => {
  it.each(someoneOfEachTenant)(
    'lists the deleted branches, newest first, with who deleted each and how many pages went with it, %s',
    async (_case, someone) => {
      const alice = { ...someone(), name: 'Alice Martin' }
      const wiki = await aWikiOf(api, alice)
      const onboarding = await aPage(api, alice, wiki.id, {
        title: 'Onboarding'
      })
      await aPage(api, alice, wiki.id, {
        title: 'Laptop setup',
        parentId: onboarding
      })
      const releases = await aPage(api, alice, wiki.id, { title: 'Releases' })
      await aPage(api, alice, wiki.id, { title: 'Roadmap' })
      await deletePage(api, alice, onboarding)
      await deletePage(api, alice, releases)

      const response = await api.as(alice).get(`/wikis/${wiki.id}/trash`)

      expect(response.statusCode).toBe(200)
      expect(response.json()).toEqual({
        pages: [
          {
            id: releases,
            title: 'Releases',
            deletedAt: (await pageOf(api, alice, releases)).deletedAt,
            deletedBy: personOf(alice),
            descendants: 0
          },
          {
            id: onboarding,
            title: 'Onboarding',
            deletedAt: (await pageOf(api, alice, onboarding)).deletedAt,
            deletedBy: personOf(alice),
            descendants: 1
          }
        ]
      })
    }
  )

  it('lists a child page deleted before as a branch of its own', async () => {
    const alice = aUser()
    const wiki = await aWikiOf(api, alice)
    const onboarding = await aPage(api, alice, wiki.id, { title: 'Onboarding' })
    const laptop = await aPage(api, alice, wiki.id, {
      title: 'Laptop setup',
      parentId: onboarding
    })
    await aPage(api, alice, wiki.id, { title: 'Accounts', parentId: laptop })
    await deletePage(api, alice, laptop)
    await deletePage(api, alice, onboarding)

    expect(
      (await trashOf(alice, wiki.id)).map(({ title, descendants }) => ({
        title,
        descendants
      }))
    ).toEqual([
      { title: 'Onboarding', descendants: 0 },
      { title: 'Laptop setup', descendants: 1 }
    ])
  })

  it('names who deleted a branch after they leave the wiki', async () => {
    const alice = aUser()
    const bob = aUser({ organizationId: alice.organizationId, name: 'Bob' })
    const wiki = await aWikiOf(api, alice)
    await joinWiki(db, alice, wiki.id, bob, 'editor')
    const onboarding = await aPage(api, alice, wiki.id, { title: 'Onboarding' })
    await deletePage(api, bob, onboarding)

    await removeFromWiki(db, alice, wiki.id, bob)

    const [entry] = await trashOf(alice, wiki.id)
    expect(entry?.deletedBy).toEqual(personOf(bob))
  })

  it('lists none of the pages of another wiki', async () => {
    const alice = aUser()
    const wiki = await aWikiOf(api, alice)
    const other = await aWikiOf(api, alice, 'Other')
    const elsewhere = await aPage(api, alice, other.id, { title: 'Elsewhere' })
    await deletePage(api, alice, elsewhere)

    expect(await trashOf(alice, wiki.id)).toEqual([])
  })

  it('lists the trash to a viewer of the wiki', async () => {
    const alice = aUser()
    const bob = aUser({ organizationId: alice.organizationId })
    const wiki = await aWikiOf(api, alice)
    await joinWiki(db, alice, wiki.id, bob, 'viewer')
    const onboarding = await aPage(api, alice, wiki.id, { title: 'Onboarding' })
    await deletePage(api, alice, onboarding)

    const response = await api.as(bob).get(`/wikis/${wiki.id}/trash`)

    expect(response.statusCode).toBe(200)
    expect(
      response.json<{ pages: TrashEntry[] }>().pages.map(({ id }) => id)
    ).toEqual([onboarding])
  })

  it('answers not_found to someone who is no member', async () => {
    const alice = aUser()
    const outsider = aUser({ organizationId: alice.organizationId })
    const wiki = await aWikiOf(api, alice)

    const response = await api.as(outsider).get(`/wikis/${wiki.id}/trash`)

    expect(response.statusCode).toBe(404)
    expect(response.json()).toEqual({ error: 'not_found' })
  })

  it.each(waysOutOfAWiki)(
    'answers not_found for %s',
    async (_case, someone, takeOut) => {
      const alice = someone()
      const carol = aUser({ organizationId: alice.organizationId })
      const wiki = await aWikiOf(api, carol)
      await joinWiki(db, carol, wiki.id, alice, 'viewer')
      const onboarding = await aPage(api, carol, wiki.id, {
        title: 'Onboarding'
      })
      await deletePage(api, carol, onboarding)

      await takeOut(api, carol, wiki.id, alice)
      const response = await api.as(alice).get(`/wikis/${wiki.id}/trash`)

      expect(response.statusCode).toBe(404)
      expect(response.json()).toEqual({ error: 'not_found' })
    }
  )

  it.each(malformedOrUnknownIds)(
    'answers not_found for a wiki with %s',
    async (_case, wikiId) => {
      const response = await api.as(aUser()).get(`/wikis/${wikiId}/trash`)

      expect(response.statusCode).toBe(404)
      expect(response.json()).toEqual({ error: 'not_found' })
    }
  )
})

describe('POST /pages/:pageId/restore', () => {
  it.each(someoneOfEachTenant)(
    'brings the branch back under its parent, after its siblings, %s',
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
      await aPage(api, alice, wiki.id, { title: 'Accounts', parentId: laptop })
      await deletePage(api, alice, laptop)
      // Badges takes the place Laptop setup left.
      await aPage(api, alice, wiki.id, {
        title: 'Badges',
        parentId: onboarding
      })

      const response = await restorePage(api, alice, laptop)

      expect(response.statusCode).toBe(200)
      expect(response.json()).toEqual(
        await placeOf(api, alice, wiki.id, laptop)
      )
      expect(await titlesUnder(api, alice, wiki.id, onboarding)).toEqual([
        'Badges',
        'Laptop setup'
      ])
      expect(await titlesUnder(api, alice, wiki.id, laptop)).toEqual([
        'Accounts'
      ])
      expect(await trashOf(alice, wiki.id)).toEqual([])
    }
  )

  it('brings the branch back to the top of the tree, last, when its parent is in the trash', async () => {
    const alice = aUser()
    const wiki = await aWikiOf(api, alice)
    const onboarding = await aPage(api, alice, wiki.id, { title: 'Onboarding' })
    const laptop = await aPage(api, alice, wiki.id, {
      title: 'Laptop setup',
      parentId: onboarding
    })
    await aPage(api, alice, wiki.id, { title: 'Releases' })
    await deletePage(api, alice, laptop)
    await deletePage(api, alice, onboarding)

    const response = await restorePage(api, alice, laptop)

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual(await placeOf(api, alice, wiki.id, laptop))
    expect(await titlesUnder(api, alice, wiki.id, null)).toEqual([
      'Releases',
      'Laptop setup'
    ])
    expect((await trashOf(alice, wiki.id)).map(({ id }) => id)).toEqual([
      onboarding
    ])
  })

  it('leaves a child page deleted before in the trash', async () => {
    const alice = aUser()
    const wiki = await aWikiOf(api, alice)
    const onboarding = await aPage(api, alice, wiki.id, { title: 'Onboarding' })
    const laptop = await aPage(api, alice, wiki.id, {
      title: 'Laptop setup',
      parentId: onboarding
    })
    await deletePage(api, alice, laptop)
    await deletePage(api, alice, onboarding)

    await restorePage(api, alice, onboarding)

    expect(await titlesUnder(api, alice, wiki.id, null)).toEqual(['Onboarding'])
    expect(await titlesUnder(api, alice, wiki.id, onboarding)).toEqual([])
    expect((await trashOf(alice, wiki.id)).map(({ id }) => id)).toEqual([
      laptop
    ])
  })

  it('moves the wiki’s version, so every open tree shows the page back', async () => {
    const alice = aUser()
    const wiki = await aWikiOf(api, alice)
    const onboarding = await aPage(api, alice, wiki.id, { title: 'Onboarding' })
    await deletePage(api, alice, onboarding)
    const before = await versionOf(api, alice, wiki.id)

    await restorePage(api, alice, onboarding)

    expect(await versionOf(api, alice, wiki.id)).toBe(before + 1)
  })

  it('drops the purge of the branch', async () => {
    const alice = aUser()
    const wiki = await aWikiOf(api, alice)
    const onboarding = await aPage(api, alice, wiki.id, { title: 'Onboarding' })
    await deletePage(api, alice, onboarding)

    await restorePage(api, alice, onboarding)

    expect(await purgeJobOfBranch(onboarding)).toBeUndefined()
  })

  // The job is dropped before the person's role is checked: the refusal
  // rolls it back.
  it('keeps the purge of a branch it refuses to restore', async () => {
    const alice = aUser()
    const bob = aUser({ organizationId: alice.organizationId })
    const wiki = await aWikiOf(api, alice)
    await joinWiki(db, alice, wiki.id, bob, 'viewer')
    const onboarding = await aPage(api, alice, wiki.id, { title: 'Onboarding' })
    await deletePage(api, alice, onboarding)
    const job = await purgeJobOfBranch(onboarding)

    await restorePage(api, bob, onboarding)

    expect(await purgeJobOfBranch(onboarding)).toEqual(job)
  })

  it('answers not_in_trash for a live page', async () => {
    const alice = aUser()
    const wiki = await aWikiOf(api, alice)
    const onboarding = await aPage(api, alice, wiki.id, { title: 'Onboarding' })
    const before = await versionOf(api, alice, wiki.id)

    const response = await restorePage(api, alice, onboarding)

    expect(response.statusCode).toBe(409)
    expect(response.json()).toEqual({ error: 'not_in_trash' })
    expect(await versionOf(api, alice, wiki.id)).toBe(before)
  })

  it('answers not_in_trash for a page deleted with its parent', async () => {
    const alice = aUser()
    const wiki = await aWikiOf(api, alice)
    const onboarding = await aPage(api, alice, wiki.id, { title: 'Onboarding' })
    const laptop = await aPage(api, alice, wiki.id, {
      title: 'Laptop setup',
      parentId: onboarding
    })
    await deletePage(api, alice, onboarding)
    const before = await versionOf(api, alice, wiki.id)

    const response = await restorePage(api, alice, laptop)

    expect(response.statusCode).toBe(409)
    expect(response.json()).toEqual({ error: 'not_in_trash' })
    expect(await versionOf(api, alice, wiki.id)).toBe(before)
    expect((await pageOf(api, alice, laptop)).deletedAt).not.toBeNull()
  })

  it('lets an editor of the wiki restore a page', async () => {
    const alice = aUser()
    const bob = aUser({ organizationId: alice.organizationId })
    const wiki = await aWikiOf(api, alice)
    await joinWiki(db, alice, wiki.id, bob, 'editor')
    const onboarding = await aPage(api, alice, wiki.id, { title: 'Onboarding' })
    await deletePage(api, alice, onboarding)

    const response = await restorePage(api, bob, onboarding)

    expect(response.statusCode).toBe(200)
    expect(await titlesUnder(api, alice, wiki.id, null)).toEqual(['Onboarding'])
  })

  it('answers forbidden to a viewer of the wiki', async () => {
    const alice = aUser()
    const bob = aUser({ organizationId: alice.organizationId })
    const wiki = await aWikiOf(api, alice)
    await joinWiki(db, alice, wiki.id, bob, 'viewer')
    const onboarding = await aPage(api, alice, wiki.id, { title: 'Onboarding' })
    await deletePage(api, alice, onboarding)
    const before = await versionOf(api, alice, wiki.id)

    const response = await restorePage(api, bob, onboarding)

    expect(response.statusCode).toBe(403)
    expect(response.json()).toEqual({ error: 'forbidden' })
    expect(await versionOf(api, alice, wiki.id)).toBe(before)
    expect(await titlesUnder(api, alice, wiki.id, null)).toEqual([])
  })

  // The person's role is checked before the page.
  it('answers forbidden to a viewer restoring a live page', async () => {
    const alice = aUser()
    const bob = aUser({ organizationId: alice.organizationId })
    const wiki = await aWikiOf(api, alice)
    await joinWiki(db, alice, wiki.id, bob, 'viewer')
    const onboarding = await aPage(api, alice, wiki.id, { title: 'Onboarding' })
    const before = await versionOf(api, alice, wiki.id)

    const response = await restorePage(api, bob, onboarding)

    expect(response.statusCode).toBe(403)
    expect(response.json()).toEqual({ error: 'forbidden' })
    expect(await versionOf(api, alice, wiki.id)).toBe(before)
  })

  it('answers not_found to someone who is no member', async () => {
    const alice = aUser()
    const outsider = aUser({ organizationId: alice.organizationId })
    const wiki = await aWikiOf(api, alice)
    const onboarding = await aPage(api, alice, wiki.id, { title: 'Onboarding' })
    await deletePage(api, alice, onboarding)
    const before = await versionOf(api, alice, wiki.id)

    const response = await restorePage(api, outsider, onboarding)

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
      await deletePage(api, carol, onboarding)
      await takeOut(api, carol, wiki.id, alice)
      const before = await wikiRowsOf(db, carol, wiki.id)

      const response = await restorePage(api, alice, onboarding)

      expect(response.statusCode).toBe(404)
      expect(response.json()).toEqual({ error: 'not_found' })
      expect(await wikiRowsOf(db, carol, wiki.id)).toEqual(before)
    }
  )

  it.each(malformedOrUnknownIds)(
    'answers not_found for a page with %s',
    async (_case, pageId) => {
      const response = await restorePage(api, aUser(), pageId)

      expect(response.statusCode).toBe(404)
      expect(response.json()).toEqual({ error: 'not_found' })
    }
  )

  // Each request waits for the wiki's row lock, which the change holds, then
  // reads the tree as the request before it left it.
  it('answers not_in_trash to the later of two restores that cross', async () => {
    const alice = aUser()
    const bob = aUser({ organizationId: alice.organizationId })
    const wiki = await aWikiOf(api, alice)
    await joinWiki(db, alice, wiki.id, bob, 'editor')
    const onboarding = await aPage(api, alice, wiki.id, { title: 'Onboarding' })
    await deletePage(api, alice, onboarding)
    const before = await versionOf(api, alice, wiki.id)

    const [first, second] = await behindAChange(db, alice, wiki.id, [
      () => restorePage(api, alice, onboarding),
      () => restorePage(api, bob, onboarding)
    ])

    expect(first?.statusCode).toBe(200)
    expect(second?.statusCode).toBe(409)
    expect(second?.json()).toEqual({ error: 'not_in_trash' })
    // Moved by the first restore, never by the refused one.
    expect(await versionOf(api, alice, wiki.id)).toBe(before + 1)
    expect(await titlesUnder(api, alice, wiki.id, null)).toEqual(['Onboarding'])
  })

  it('brings the branch to the top when its parent goes to the trash while it waits its turn', async () => {
    const alice = aUser()
    const bob = aUser({ organizationId: alice.organizationId })
    const wiki = await aWikiOf(api, alice)
    await joinWiki(db, alice, wiki.id, bob, 'editor')
    const onboarding = await aPage(api, alice, wiki.id, { title: 'Onboarding' })
    const laptop = await aPage(api, alice, wiki.id, {
      title: 'Laptop setup',
      parentId: onboarding
    })
    await deletePage(api, alice, laptop)

    const [deleted, restored] = await behindAChange(db, alice, wiki.id, [
      () => deletePage(api, alice, onboarding),
      () => restorePage(api, bob, laptop)
    ])

    expect(deleted?.statusCode).toBe(204)
    expect(restored?.statusCode).toBe(200)
    expect(restored?.json()).toEqual(await placeOf(api, alice, wiki.id, laptop))
    expect(await titlesUnder(api, alice, wiki.id, null)).toEqual([
      'Laptop setup'
    ])
  })
})

describe('the purge of a deleted branch, once due', () => {
  it.each(someoneOfEachTenant)(
    'deletes the branch for good, with what hangs off its pages, %s',
    async (_case, someone) => {
      const alice = someone()
      const bob = aUser({ organizationId: alice.organizationId })
      const wiki = await aWikiOf(api, alice)
      await joinWiki(db, alice, wiki.id, bob, 'editor')
      const onboarding = await aPage(api, alice, wiki.id, {
        title: 'Onboarding'
      })
      const laptop = await aPage(api, alice, wiki.id, {
        title: 'Laptop setup',
        parentId: onboarding
      })
      // Beside its versions and its followers, a page carries labels, and
      // its readers' favorites and visits.
      await setLabels(api, alice, laptop, ['howto'])
      await api.as(alice).put(`/pages/${laptop}/favorite`)
      await pageOf(api, alice, laptop)
      await deletePage(api, bob, onboarding)
      // Whoever deleted the branch may leave the wiki before its purge.
      await removeFromWiki(db, alice, wiki.id, bob)

      await purgeWhenDue(onboarding)

      const pageIds = [onboarding, laptop]
      const responses = await Promise.all(
        pageIds.map(pageId => api.as(alice).get(`/pages/${pageId}`))
      )
      expect(responses.map(({ statusCode }) => statusCode)).toEqual([404, 404])
      expect(await trashOf(alice, wiki.id)).toEqual([])
    }
  )

  // The job runs as the wiki's creator, whom the wikis policy shows the wiki
  // out of it too.
  it('purges the branch once the wiki’s creator is removed from it, in B2C', async () => {
    const carol = aB2cUser()
    const alice = aB2cUser()
    const wiki = await aWikiOf(api, carol)
    await joinWiki(db, carol, wiki.id, alice, 'admin')
    const onboarding = await aPage(api, alice, wiki.id, { title: 'Onboarding' })
    await deletePage(api, alice, onboarding)
    expect(
      (await removeMember(api, alice, wiki.id, carol.userId)).statusCode
    ).toBe(204)

    await purgeWhenDue(onboarding)

    expect((await api.as(alice).get(`/pages/${onboarding}`)).statusCode).toBe(
      404
    )
    expect(await trashOf(alice, wiki.id)).toEqual([])
  })

  it('purges the branch once the account of the wiki’s creator is deleted, in B2C', async () => {
    const carol = aB2cUser()
    const alice = aB2cUser()
    const wiki = await aWikiOf(api, carol)
    await joinWiki(db, carol, wiki.id, alice, 'editor')
    const onboarding = await aPage(api, alice, wiki.id, { title: 'Onboarding' })
    await deletePage(api, alice, onboarding)
    // The wiki goes on, with alice as its admin.
    await deliverAccountEvent(db, 'user.deleted', { uuid: carol.userId })

    await purgeWhenDue(onboarding)

    expect((await api.as(alice).get(`/pages/${onboarding}`)).statusCode).toBe(
      404
    )
    expect(await trashOf(alice, wiki.id)).toEqual([])
  })

  it('purges the branch of a space’s wiki, whose creator is the space', async () => {
    const alice = aUser()
    const wikiId = await aSpaceWiki(db, [[alice, 'admin']])
    const onboarding = await aPage(api, alice, wikiId, { title: 'Onboarding' })
    await deletePage(api, alice, onboarding)

    await purgeWhenDue(onboarding)

    expect((await api.as(alice).get(`/pages/${onboarding}`)).statusCode).toBe(
      404
    )
    expect(await trashOf(alice, wikiId)).toEqual([])
  })

  it('deletes the labels only the branch carried', async () => {
    const alice = aUser()
    const wiki = await aWikiOf(api, alice)
    const onboarding = await aPage(api, alice, wiki.id, { title: 'Onboarding' })
    const holidays = await aPage(api, alice, wiki.id, { title: 'Holidays' })
    await setLabels(api, alice, onboarding, ['howto', 'draft'])
    await setLabels(api, alice, holidays, ['howto'])
    await deletePage(api, alice, onboarding)

    await purgeWhenDue(onboarding)

    expect(await labelNamesIn(db, alice, wiki.id)).toEqual(['howto'])
  })

  it('leaves a branch deleted before under it in the trash, to come back at the top of the tree', async () => {
    const alice = aUser()
    const wiki = await aWikiOf(api, alice)
    const onboarding = await aPage(api, alice, wiki.id, { title: 'Onboarding' })
    const laptop = await aPage(api, alice, wiki.id, {
      title: 'Laptop setup',
      parentId: onboarding
    })
    await aPage(api, alice, wiki.id, { title: 'Accounts', parentId: laptop })
    await deletePage(api, alice, laptop)
    await deletePage(api, alice, onboarding)

    await purgeWhenDue(onboarding)

    expect((await trashOf(alice, wiki.id)).map(({ id }) => id)).toEqual([
      laptop
    ])
    await restorePage(api, alice, laptop)
    expect(await titlesUnder(api, alice, wiki.id, null)).toEqual([
      'Laptop setup'
    ])
    expect(await titlesUnder(api, alice, wiki.id, laptop)).toEqual(['Accounts'])
  })

  it('moves the wiki’s version, so every open trash shows the branch gone', async () => {
    const alice = aUser()
    const wiki = await aWikiOf(api, alice)
    const onboarding = await aPage(api, alice, wiki.id, { title: 'Onboarding' })
    await deletePage(api, alice, onboarding)
    const before = await versionOf(api, alice, wiki.id)

    await purgeWhenDue(onboarding)

    expect(await versionOf(api, alice, wiki.id)).toBe(before + 1)
  })

  // A restore sent while the page is live waits for the wiki's row lock
  // behind its delete, after it found no job to drop: the job outlives the
  // branch's stay in the trash.
  it('leaves the wiki’s version alone once the branch is out of the trash', async () => {
    const alice = aUser()
    const wiki = await aWikiOf(api, alice)
    const onboarding = await aPage(api, alice, wiki.id, { title: 'Onboarding' })
    await deletePage(api, alice, onboarding)
    const left = await purgeJobOfBranch(onboarding)
    await restorePage(api, alice, onboarding)
    const before = await versionOf(api, alice, wiki.id)

    await runPurge(left)

    expect(await versionOf(api, alice, wiki.id)).toBe(before)
    expect(await titlesUnder(api, alice, wiki.id, null)).toEqual(['Onboarding'])
  })

  // The scheduler would try a job that throws again and again.
  it('leaves the branch of a deleted wiki to the purge of the wiki', async () => {
    const alice = aUser()
    const wiki = await aWikiOf(api, alice)
    const onboarding = await aPage(api, alice, wiki.id, { title: 'Onboarding' })
    await deletePage(api, alice, onboarding)
    await api.as(alice).delete(`/wikis/${wiki.id}`)
    const before = await wikiRowsOf(db, alice, wiki.id)

    await expect(purgeWhenDue(onboarding)).resolves.toBeUndefined()

    expect(await wikiRowsOf(db, alice, wiki.id)).toEqual(before)
    // An organization's people see the pages of its deleted wikis.
    const branch = await inTenant(db, alice, tx =>
      tx
        .select({ id: pages.id })
        .from(pages)
        .where(eq(pages.trashRootId, onboarding))
    )
    expect(branch).toEqual([{ id: onboarding }])
  })
})

import { randomUUID } from 'node:crypto'
import { desc, eq } from 'drizzle-orm'
import { generateNKeysBetween } from 'fractional-indexing'
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest'
import { createDb, inTenant } from '../../infra/db.ts'
import {
  aB2cUser,
  aPageIn,
  aUser,
  aWikiOf,
  joinWiki,
  startApp,
  type TestUser
} from '../../testing/app.ts'
import { pageFollowers } from '../notifications/schema.ts'
import {
  labels,
  pageFavorites,
  pageLabels,
  pages,
  pageVersions,
  pageVisits
} from './schema.ts'

let api: Awaited<ReturnType<typeof startApp>>
const { sql, db } = createDb(inject('databaseUrl'))

beforeAll(async () => {
  api = await startApp()
})

afterAll(async () => {
  await api.close()
  await sql.end()
})

interface Person {
  id: string
  email: string
  name: string | null
}

interface Page {
  id: string
  version: number
  createdBy: Person
  updatedBy: Person
  labels: string[]
  ancestors: { id: string; title: string }[]
  following: boolean
  favorite: boolean
  deletedAt: string | null
}

const personOf = (user: TestUser): Person => ({
  id: user.userId,
  email: user.email,
  name: user.name ?? null
})

const pageOf = async (user: TestUser, pageId: string) =>
  (await api.as(user).get(`/pages/${pageId}`)).json<Page>()

// Publishing is not served yet, so versions are written as it will write them.
const publish = (editor: TestUser, pageId: string, number: number) =>
  inTenant(db, editor, async tx => {
    const title = `Version ${String(number)}`
    await tx.insert(pageVersions).values({
      pageId,
      organizationId: editor.organizationId,
      number,
      title,
      authorId: editor.userId,
      authorEmail: editor.email,
      authorName: editor.name ?? null
    })
    await tx
      .update(pages)
      .set({
        title,
        version: number,
        updatedBy: editor.userId,
        updatedAt: new Date()
      })
      .where(eq(pages.id, pageId))
  })

// Nor is labelling.
const label = (
  editor: TestUser,
  wikiId: string,
  pageId: string,
  names: string[]
) =>
  inTenant(db, editor, async tx => {
    const made = await tx
      .insert(labels)
      .values(
        names.map(name => ({
          wikiId,
          organizationId: editor.organizationId,
          name
        }))
      )
      .returning({ id: labels.id })
    await tx.insert(pageLabels).values(
      made.map(({ id }) => ({
        pageId,
        labelId: id,
        organizationId: editor.organizationId
      }))
    )
  })

// Nor are following and favorites.
const follow = (user: TestUser, pageId: string) =>
  inTenant(db, user, tx =>
    tx.insert(pageFollowers).values({
      pageId,
      organizationId: user.organizationId,
      userId: user.userId
    })
  )

const keepAsFavorite = (user: TestUser, pageId: string) =>
  inTenant(db, user, tx =>
    tx.insert(pageFavorites).values({
      pageId,
      organizationId: user.organizationId,
      userId: user.userId
    })
  )

// Nor is Recent, so visits are read from their table, the last one first.
const visitsOf = async (user: TestUser) => {
  const visits = await inTenant(db, user, tx =>
    tx
      .select({ pageId: pageVisits.pageId })
      .from(pageVisits)
      .where(eq(pageVisits.userId, user.userId))
      .orderBy(desc(pageVisits.visitedAt))
  )
  return visits.map(visit => visit.pageId)
}

/** Pages of the wiki the person visited one after the other, long ago. */
const visitedLongAgo = async (
  user: TestUser,
  wikiId: string,
  count: number
) => {
  const visited: string[] = []
  for (const position of generateNKeysBetween(null, null, count)) {
    visited.push(await aPageIn(db, user, wikiId, { title: position, position }))
  }
  await inTenant(db, user, tx =>
    tx.insert(pageVisits).values(
      visited.map((pageId, minutes) => ({
        pageId,
        organizationId: user.organizationId,
        userId: user.userId,
        visitedAt: new Date(2026, 0, 1, 0, minutes)
      }))
    )
  )
  return visited
}

describe('GET /pages/:pageId', () => {
  it('answers the home page of a new wiki to its admin', async () => {
    const alice = aUser({ name: 'Alice Martin' })
    const wiki = await aWikiOf(api, alice, 'Handbook')

    const response = await api.as(alice).get(`/pages/${wiki.homePageId}`)

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({
      id: wiki.homePageId,
      wikiId: wiki.id,
      parentId: null,
      home: true,
      kind: 'document',
      title: 'Handbook',
      content: [],
      gristUrl: null,
      version: 1,
      createdAt: expect.any(String) as string,
      createdBy: personOf(alice),
      updatedAt: expect.any(String) as string,
      updatedBy: personOf(alice),
      labels: [],
      ancestors: [],
      following: false,
      favorite: false,
      deletedAt: null
    })
  })

  it('names the author of its first version and of its current one', async () => {
    const alice = aUser({ name: 'Alice Martin' })
    const bob = aUser({ organizationId: alice.organizationId, name: null })
    const wiki = await aWikiOf(api, alice)
    await joinWiki(db, alice, wiki.id, bob, 'editor')
    await publish(bob, wiki.homePageId, 2)

    const page = await pageOf(alice, wiki.homePageId)

    expect({
      version: page.version,
      createdBy: page.createdBy,
      updatedBy: page.updatedBy
    }).toEqual({
      version: 2,
      createdBy: personOf(alice),
      updatedBy: personOf(bob)
    })
  })

  it('lists its ancestors from the top of the tree down to its parent', async () => {
    const alice = aUser()
    const wiki = await aWikiOf(api, alice)
    const plans = await aPageIn(db, alice, wiki.id, {
      title: 'Plans',
      position: 'a0'
    })
    const q1 = await aPageIn(db, alice, wiki.id, {
      title: 'Q1',
      position: 'a0',
      parentId: plans
    })
    const week = await aPageIn(db, alice, wiki.id, {
      title: 'Week 1',
      position: 'a0',
      parentId: q1
    })

    const page = await pageOf(alice, week)

    expect(page.ancestors).toEqual([
      { id: plans, title: 'Plans' },
      { id: q1, title: 'Q1' }
    ])
  })

  it('gives the names of its own labels, sorted', async () => {
    const alice = aUser()
    const wiki = await aWikiOf(api, alice)
    const plans = await aPageIn(db, alice, wiki.id, {
      title: 'Plans',
      position: 'a0'
    })
    const archive = await aPageIn(db, alice, wiki.id, {
      title: 'Archive',
      position: 'a1'
    })
    await label(alice, wiki.id, plans, ['roadmap', 'draft'])
    await label(alice, wiki.id, archive, ['old'])

    expect((await pageOf(alice, plans)).labels).toEqual(['draft', 'roadmap'])
  })

  it('tells each person whether they follow it and keep it as a favorite', async () => {
    const alice = aUser()
    const bob = aUser({ organizationId: alice.organizationId })
    const wiki = await aWikiOf(api, alice)
    await joinWiki(db, alice, wiki.id, bob, 'viewer')
    await follow(alice, wiki.homePageId)
    await keepAsFavorite(bob, wiki.homePageId)

    const marks = await Promise.all(
      [alice, bob].map(async user => {
        const page = await pageOf(user, wiki.homePageId)
        return { following: page.following, favorite: page.favorite }
      })
    )

    expect(marks).toEqual([
      { following: true, favorite: false },
      { following: false, favorite: true }
    ])
  })

  it('answers a page in the trash, with when it was deleted', async () => {
    const alice = aUser()
    const wiki = await aWikiOf(api, alice)
    const drafts = await aPageIn(db, alice, wiki.id, {
      title: 'Drafts',
      position: 'a0',
      deleted: true
    })

    const page = await pageOf(alice, drafts)

    expect(page.deletedAt).toEqual(expect.any(String))
  })

  it.each(['viewer', 'editor'] as const)(
    'answers the wiki’s %ss',
    async role => {
      const alice = aUser()
      const bob = aUser({ organizationId: alice.organizationId })
      const wiki = await aWikiOf(api, alice)
      await joinWiki(db, alice, wiki.id, bob, role)

      const response = await api.as(bob).get(`/pages/${wiki.homePageId}`)

      expect(response.statusCode).toBe(200)
      expect(response.json<Page>().id).toBe(wiki.homePageId)
    }
  )

  it.each([
    [
      'in the same organization',
      (): [TestUser, TestUser] => {
        const alice = aUser()
        return [alice, aUser({ organizationId: alice.organizationId })]
      }
    ],
    ['in another organization', (): [TestUser, TestUser] => [aUser(), aUser()]],
    ['among B2C users', (): [TestUser, TestUser] => [aB2cUser(), aB2cUser()]]
  ])(
    'answers not_found to someone %s who is no member',
    async (_case, people) => {
      const [alice, outsider] = people()
      const wiki = await aWikiOf(api, alice)

      const response = await api.as(outsider).get(`/pages/${wiki.homePageId}`)

      expect(response.statusCode).toBe(404)
      expect(response.json()).toEqual({ error: 'not_found' })
    }
  )

  it('answers not_found to everyone once the wiki is deleted', async () => {
    const alice = aUser()
    const wiki = await aWikiOf(api, alice)
    await api.as(alice).delete(`/wikis/${wiki.id}`)

    const response = await api.as(alice).get(`/pages/${wiki.homePageId}`)

    expect(response.statusCode).toBe(404)
    expect(response.json()).toEqual({ error: 'not_found' })
  })

  it.each([
    ['a malformed id', 'not-an-id'],
    ['an unknown id', randomUUID()]
  ])('answers not_found for %s', async (_case, pageId) => {
    const response = await api.as(aUser()).get(`/pages/${pageId}`)

    expect(response.statusCode).toBe(404)
    expect(response.json()).toEqual({ error: 'not_found' })
  })

  it('records each visit for Recent, the last one first', async () => {
    const alice = aUser()
    const wiki = await aWikiOf(api, alice)
    const plans = await aPageIn(db, alice, wiki.id, {
      title: 'Plans',
      position: 'a0'
    })

    await pageOf(alice, wiki.homePageId)
    await pageOf(alice, plans)
    await pageOf(alice, wiki.homePageId)

    expect(await visitsOf(alice)).toEqual([wiki.homePageId, plans])
  })

  it('keeps the person’s 100 most recent visits', async () => {
    const alice = aUser()
    const wiki = await aWikiOf(api, alice)
    const visited = await visitedLongAgo(alice, wiki.id, 100)

    await pageOf(alice, wiki.homePageId)

    const visits = await visitsOf(alice)
    expect({
      count: visits.length,
      last: visits[0],
      oldest: visits.at(-1)
    }).toEqual({ count: 100, last: wiki.homePageId, oldest: visited[1] })
  })
})

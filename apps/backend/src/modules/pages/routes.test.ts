import { randomUUID } from 'node:crypto'
import { desc, eq } from 'drizzle-orm'
import { generateNKeysBetween } from 'fractional-indexing'
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest'
import { createDb, inTenant } from '../../infra/db.ts'
import {
  aB2cUser,
  addVersion,
  aPageIn,
  aUser,
  aWikiOf,
  createPage,
  joinWiki,
  removeFromWiki,
  startApp,
  versionOf,
  type TestUser
} from '../../testing/app.ts'
import { pageFollowers } from '../notifications/schema.ts'
import {
  labels,
  pageFavorites,
  pageLabels,
  pages,
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
  parentId: string | null
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
    await addVersion(tx, editor, { pageId, number, title })
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
  // At once: one after the other, a hundred pages outlast the test's time on
  // a busy machine.
  const visited = await Promise.all(
    generateNKeysBetween(null, null, count).map(position =>
      aPageIn(db, user, wikiId, { title: position, position })
    )
  )
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
      following: true,
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
    const plans = await aPageIn(db, alice, wiki.id, {
      title: 'Plans',
      position: 'a0'
    })
    await joinWiki(db, alice, wiki.id, bob, 'viewer')
    await follow(alice, plans)
    await keepAsFavorite(bob, plans)

    const marks = await Promise.all(
      [alice, bob].map(async user => {
        const page = await pageOf(user, plans)
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

  // A B2C person no longer sees the visits of a wiki they left.
  it('counts among the 100 the visits of a wiki the person left', async () => {
    const carol = aB2cUser()
    const alice = aB2cUser()
    const left = await aWikiOf(api, carol)
    await joinWiki(db, carol, left.id, alice, 'viewer')
    await inTenant(db, alice, tx =>
      tx.insert(pageVisits).values({
        pageId: left.homePageId,
        organizationId: null,
        userId: alice.userId,
        visitedAt: new Date(2025, 0, 1)
      })
    )
    await removeFromWiki(db, carol, left.id, alice)
    const own = await aWikiOf(api, alice)
    await visitedLongAgo(alice, own.id, 100)

    await pageOf(alice, own.homePageId)

    await joinWiki(db, carol, left.id, alice, 'viewer')
    const visits = await visitsOf(alice)
    expect({
      count: visits.length,
      left: visits.includes(left.homePageId)
    }).toEqual({ count: 100, left: false })
  })
})

describe('POST /wikis/:wikiId/pages', () => {
  /** The titles of the parent's children, in their order in the tree. */
  const titlesUnder = async (
    user: TestUser,
    wikiId: string,
    parentId: string | null
  ) => {
    const tree = (await api.as(user).get(`/wikis/${wikiId}/tree`)).json<{
      pages: { parentId: string | null; title: string }[]
    }>()
    return tree.pages
      .filter(page => page.parentId === parentId)
      .map(page => page.title)
  }

  it.each([
    ['in an organization', () => aUser({ name: 'Alice Martin' })],
    ['in B2C', aB2cUser]
  ])(
    'creates a page by its creator, who follows it, %s',
    async (_case, someone) => {
      const alice = someone()
      const wiki = await aWikiOf(api, alice)

      const response = await createPage(api, alice, wiki.id, {
        title: ' Onboarding '
      })

      expect(response.statusCode).toBe(201)
      expect(response.json()).toEqual({
        id: expect.any(String) as string,
        wikiId: wiki.id,
        parentId: null,
        home: false,
        kind: 'document',
        title: 'Onboarding',
        content: [],
        gristUrl: null,
        version: 1,
        createdAt: expect.any(String) as string,
        createdBy: personOf(alice),
        updatedAt: expect.any(String) as string,
        updatedBy: personOf(alice),
        labels: [],
        ancestors: [],
        following: true,
        favorite: false,
        deletedAt: null
      })
    }
  )

  it('moves the wiki’s version, so every open tree shows the page', async () => {
    const alice = aUser()
    const wiki = await aWikiOf(api, alice)
    const before = await versionOf(api, alice, wiki.id)

    await createPage(api, alice, wiki.id, { title: 'Onboarding' })

    expect(await versionOf(api, alice, wiki.id)).toBeGreaterThan(before)
  })

  type Neighbours = (siblings: { plans: string; goals: string }) => {
    afterId?: string
    beforeId?: string
  }

  it.each<[string, Neighbours, string[]]>([
    ['last by default', () => ({}), ['Plans', 'Goals', 'Onboarding']],
    [
      'right after a sibling',
      ({ plans }) => ({ afterId: plans }),
      ['Plans', 'Onboarding', 'Goals']
    ],
    [
      'right before a sibling',
      ({ plans }) => ({ beforeId: plans }),
      ['Onboarding', 'Plans', 'Goals']
    ],
    [
      'between two siblings',
      ({ plans, goals }) => ({ afterId: plans, beforeId: goals }),
      ['Plans', 'Onboarding', 'Goals']
    ]
  ])('places a page %s', async (_case, neighbours, titles) => {
    const alice = aUser()
    const wiki = await aWikiOf(api, alice)
    const plans = await createPage(api, alice, wiki.id, { title: 'Plans' })
    const goals = await createPage(api, alice, wiki.id, { title: 'Goals' })

    await createPage(api, alice, wiki.id, {
      title: 'Onboarding',
      ...neighbours({
        plans: plans.json<Page>().id,
        goals: goals.json<Page>().id
      })
    })

    expect(await titlesUnder(alice, wiki.id, null)).toEqual(titles)
  })

  it('places a child page under its parent, last among its children', async () => {
    const alice = aUser()
    const wiki = await aWikiOf(api, alice)
    const onboarding = (
      await createPage(api, alice, wiki.id, { title: 'Onboarding' })
    ).json<Page>()
    await createPage(api, alice, wiki.id, {
      title: 'Accounts',
      parentId: onboarding.id
    })

    const response = await createPage(api, alice, wiki.id, {
      title: 'Laptop setup',
      parentId: onboarding.id
    })

    const child = response.json<Page>()
    expect({ parentId: child.parentId, ancestors: child.ancestors }).toEqual({
      parentId: onboarding.id,
      ancestors: [{ id: onboarding.id, title: 'Onboarding' }]
    })
    expect(await titlesUnder(alice, wiki.id, onboarding.id)).toEqual([
      'Accounts',
      'Laptop setup'
    ])
    expect(await titlesUnder(alice, wiki.id, null)).toEqual(['Onboarding'])
  })

  type ParentOf = (
    alice: TestUser,
    wiki: { id: string; homePageId: string }
  ) => Promise<string>

  it.each<[string, ParentOf]>([
    [
      'a page of another wiki',
      async alice => {
        const other = await aWikiOf(api, alice, 'Other')
        const page = await createPage(api, alice, other.id, {
          title: 'Elsewhere'
        })
        return page.json<Page>().id
      }
    ],
    [
      'a page in the trash',
      (alice, wiki) =>
        aPageIn(db, alice, wiki.id, {
          title: 'Drafts',
          position: 'a0',
          deleted: true
        })
    ],
    [
      'the home page, which is outside the tree',
      (_alice, wiki) => Promise.resolve(wiki.homePageId)
    ],
    ['an unknown page', () => Promise.resolve(randomUUID())]
  ])('answers invalid_parent for %s', async (_case, parentOf) => {
    const alice = aUser()
    const wiki = await aWikiOf(api, alice)
    const parentId = await parentOf(alice, wiki)
    const before = await versionOf(api, alice, wiki.id)

    const response = await createPage(api, alice, wiki.id, {
      title: 'Laptop setup',
      parentId
    })

    expect(response.statusCode).toBe(400)
    expect(response.json()).toEqual({ error: 'invalid_parent' })
    expect(await versionOf(api, alice, wiki.id)).toBe(before)
  })

  type StaleNeighbours = (pages: {
    plans: string
    goals: string
    child: string
    drafts: string
  }) => { afterId?: string; beforeId?: string }

  it.each<[string, StaleNeighbours]>([
    ['a page under another parent', ({ child }) => ({ afterId: child })],
    ['a page in the trash', ({ drafts }) => ({ beforeId: drafts })],
    [
      'two siblings that are not next to each other',
      ({ plans, goals }) => ({ afterId: goals, beforeId: plans })
    ],
    ['an unknown page', () => ({ afterId: randomUUID() })]
  ])('answers stale_neighbours for %s', async (_case, neighbours) => {
    const alice = aUser()
    const wiki = await aWikiOf(api, alice)
    const drafts = await aPageIn(db, alice, wiki.id, {
      title: 'Drafts',
      position: 'a0',
      deleted: true
    })
    const plans = (
      await createPage(api, alice, wiki.id, { title: 'Plans' })
    ).json<Page>()
    const goals = (
      await createPage(api, alice, wiki.id, { title: 'Goals' })
    ).json<Page>()
    const child = await createPage(api, alice, wiki.id, {
      title: 'Q1',
      parentId: plans.id
    })
    const before = await versionOf(api, alice, wiki.id)

    const response = await createPage(api, alice, wiki.id, {
      title: 'Onboarding',
      ...neighbours({
        plans: plans.id,
        goals: goals.id,
        child: child.json<Page>().id,
        drafts
      })
    })

    expect(response.statusCode).toBe(409)
    expect(response.json()).toEqual({ error: 'stale_neighbours' })
    expect(await versionOf(api, alice, wiki.id)).toBe(before)
  })

  it('lets an editor of the wiki create a page', async () => {
    const alice = aUser()
    const bob = aUser({ organizationId: alice.organizationId })
    const wiki = await aWikiOf(api, alice)
    await joinWiki(db, alice, wiki.id, bob, 'editor')

    const response = await createPage(api, bob, wiki.id, {
      title: 'Onboarding'
    })

    expect(response.statusCode).toBe(201)
    expect(response.json<Page>().createdBy).toEqual(personOf(bob))
  })

  it('answers forbidden to a viewer of the wiki', async () => {
    const alice = aUser()
    const bob = aUser({ organizationId: alice.organizationId })
    const wiki = await aWikiOf(api, alice)
    await joinWiki(db, alice, wiki.id, bob, 'viewer')

    const response = await createPage(api, bob, wiki.id, {
      title: 'Onboarding'
    })

    expect(response.statusCode).toBe(403)
    expect(response.json()).toEqual({ error: 'forbidden' })
  })

  it('answers not_found to someone who is no member', async () => {
    const alice = aUser()
    const outsider = aUser({ organizationId: alice.organizationId })
    const wiki = await aWikiOf(api, alice)

    const response = await createPage(api, outsider, wiki.id, {
      title: 'Onboarding'
    })

    expect(response.statusCode).toBe(404)
    expect(response.json()).toEqual({ error: 'not_found' })
  })

  it('answers not_found once the wiki is deleted', async () => {
    const alice = aUser()
    const wiki = await aWikiOf(api, alice)
    await api.as(alice).delete(`/wikis/${wiki.id}`)

    const response = await createPage(api, alice, wiki.id, {
      title: 'Onboarding'
    })

    expect(response.statusCode).toBe(404)
    expect(response.json()).toEqual({ error: 'not_found' })
  })

  it.each([
    ['a malformed id', 'not-an-id'],
    ['an unknown id', randomUUID()]
  ])('answers not_found for a wiki with %s', async (_case, wikiId) => {
    const response = await createPage(api, aUser(), wikiId, {
      title: 'Onboarding'
    })

    expect(response.statusCode).toBe(404)
    expect(response.json()).toEqual({ error: 'not_found' })
  })

  it.each([
    ['no title', { kind: 'document', parentId: null }],
    ['a blank title', { title: ' ', kind: 'document', parentId: null }],
    [
      'a title over 200 characters',
      { title: 'a'.repeat(201), kind: 'document', parentId: null }
    ],
    ['no parent', { title: 'Onboarding', kind: 'document' }],
    [
      'a malformed neighbour',
      { title: 'Onboarding', kind: 'document', parentId: null, afterId: 'a0' }
    ]
  ])('answers invalid_request for %s', async (_case, body) => {
    const alice = aUser()
    const wiki = await aWikiOf(api, alice)

    const response = await api.as(alice).post(`/wikis/${wiki.id}/pages`, body)

    expect(response.statusCode).toBe(400)
    expect(response.json()).toEqual({ error: 'invalid_request' })
  })
})

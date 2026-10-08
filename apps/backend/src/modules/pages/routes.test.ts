import { randomUUID } from 'node:crypto'
import { desc, eq } from 'drizzle-orm'
import { generateNKeysBetween } from 'fractional-indexing'
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest'
import { createDb, inTenant } from '../../infra/db.ts'
import {
  aB2cUser,
  aBlock,
  addVersion,
  aPageIn,
  aUser,
  aWikiOf,
  createPage,
  GRIST_ORIGIN,
  joinWiki,
  removeFromWiki,
  startApp,
  styled,
  versionOf,
  type TestUser
} from '../../testing/app.ts'
import { pageFollowers } from '../notifications/schema.ts'
import { MAX_BLOCKS_BYTES } from './blocks.ts'
import {
  labels,
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
  parentId: string | null
  content: unknown[]
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

// Nor is following.
const follow = (user: TestUser, pageId: string) =>
  inTenant(db, user, tx =>
    tx.insert(pageFollowers).values({
      pageId,
      organizationId: user.organizationId,
      userId: user.userId
    })
  )

const keepAsFavorite = (user: TestUser, pageId: string) =>
  api.as(user).put(`/pages/${pageId}/favorite`)

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

// Nor is search, so the plain text of a page and of its versions is read from
// their tables, the first version first.
const textsOf = (user: TestUser, pageId: string) =>
  inTenant(db, user, async tx => {
    const [page] = await tx
      .select({ text: pages.text })
      .from(pages)
      .where(eq(pages.id, pageId))
    const versions = await tx
      .select({ text: pageVersions.text })
      .from(pageVersions)
      .where(eq(pageVersions.pageId, pageId))
      .orderBy(pageVersions.number)
    return { page: page?.text, versions: versions.map(({ text }) => text) }
  })

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
    [
      'a NUL character in the title',
      { title: 'On\u0000boarding', kind: 'document', parentId: null }
    ],
    [
      'a lone surrogate in the title',
      { title: 'Onboarding \ud83d', kind: 'document', parentId: null }
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

  describe('its blocks', () => {
    const aLink = (href: string, text = 'the guide') => ({
      type: 'link',
      href,
      content: [styled(text)]
    })

    const linkingTo = (href: string) =>
      aBlock('paragraph', { content: [aLink(href)] })

    const aTable = (...rows: string[][]) =>
      aBlock('table', {
        content: {
          type: 'tableContent',
          columnWidths: [null, null],
          rows: rows.map(cells => ({
            cells: cells.map(text => ({
              type: 'tableCell',
              props: { textAlignment: 'left' },
              content: [styled(text)]
            }))
          }))
        }
      })

    /** A block whose address is its `url` prop: a media or a Grist embed. */
    const anAddressed = (type: string, url: unknown) =>
      aBlock(type, { props: { url } })

    it('stores them as sent', async () => {
      const alice = aUser()
      const wiki = await aWikiOf(api, alice)
      const blocks = [
        aBlock('heading', { props: { level: 2 }, content: [styled('Steps')] }),
        aBlock('paragraph', {
          content: [styled('Read '), aLink('https://example.com/guide')],
          children: [aBlock('paragraph', { content: 'Then ask' })]
        }),
        aTable(['Laptop', 'Badge']),
        anAddressed('image', 'https://example.com/desk.png')
      ]

      const created = await createPage(api, alice, wiki.id, {
        title: 'Onboarding',
        content: blocks
      })

      expect(created.json<Page>().content).toEqual(blocks)
      const page = await pageOf(alice, created.json<Page>().id)
      expect(page.content).toEqual(blocks)
    })

    it('keeps their plain text, a line per block, table cell and caption', async () => {
      const alice = aUser()
      const wiki = await aWikiOf(api, alice)

      const created = await createPage(api, alice, wiki.id, {
        title: 'Onboarding',
        content: [
          aBlock('heading', { content: [styled('Steps')] }),
          aBlock('paragraph', {
            content: [styled('Read '), aLink('https://example.com/guide')],
            children: [aBlock('paragraph', { content: 'Then ask' })]
          }),
          aBlock('paragraph', { content: [] }),
          aTable(['Laptop', 'Badge']),
          aBlock('image', {
            props: { url: 'https://example.com/desk.png', caption: 'A desk' }
          }),
          aBlock('codeBlock', { content: [styled('npm ci')] })
        ]
      })

      const text =
        'Steps\nRead the guide\nThen ask\nLaptop\nBadge\nA desk\nnpm ci'
      expect(await textsOf(alice, created.json<Page>().id)).toEqual({
        page: text,
        versions: [text]
      })
    })

    /** ASCII words, none of them twice, in `bytes`. */
    const distinctWords = (bytes: number) => {
      let text = ''
      for (let i = 0; text.length < bytes; i += 1) {
        text += `w${i.toString(36)} `
      }
      return text.slice(0, bytes)
    }

    /**
     * Hyphenated pairs of words of 31 ideographs, none of them twice, in
     * `bytes`. The ideographs, of Extension B, take 4 bytes each in UTF-8,
     * and the nth word is the 31 of them from the nth on.
     */
    const hyphenatedWords = (bytes: number) => {
      const word = (n: number) =>
        String.fromCodePoint(
          ...Array.from({ length: 31 }, (_, i) => 0x20000 + ((n + i) % 42_711))
        )
      const pairBytes = 2 * 31 * 4 + 2
      const pairs = Math.floor(bytes / pairBytes)
      const text = Array.from(
        { length: pairs },
        (_, n) => `${word(2 * n)}-${word(2 * n + 1)} `
      )
      return text.join('') + ' '.repeat(bytes - pairs * pairBytes)
    }

    /** A paragraph of `words` that weighs `bytes` in JSON. */
    const weighing = (bytes: number, words = distinctWords) => {
      const block = aBlock('paragraph', { content: [styled('')] })
      const text = words(bytes - JSON.stringify([block]).length)
      return [{ ...block, content: [styled(text)] }]
    }

    // Search keeps each word of a page once, in at most 1 MiB: distinct
    // words are the most words it has to keep, and hyphenated words of 4-byte
    // letters, which it keeps whole and in parts, the most bytes a character.
    it.each([
      ['distinct words', distinctWords],
      ['hyphenated words of 4-byte letters', hyphenatedWords]
    ])('takes 2 MiB of them in JSON, in %s', async (_case, words) => {
      const alice = aUser()
      const wiki = await aWikiOf(api, alice)

      const response = await createPage(api, alice, wiki.id, {
        title: 'Onboarding',
        content: weighing(MAX_BLOCKS_BYTES, words)
      })

      expect(response.statusCode).toBe(201)
    })

    it.each([
      ['a byte over 2 MiB in JSON', MAX_BLOCKS_BYTES + 1],
      ['in a body over the size of any request', 2 * MAX_BLOCKS_BYTES]
    ])('answers invalid_content for blocks %s', async (_case, bytes) => {
      const alice = aUser()
      const wiki = await aWikiOf(api, alice)

      const response = await createPage(api, alice, wiki.id, {
        title: 'Onboarding',
        content: weighing(bytes)
      })

      expect(response.statusCode).toBe(400)
      expect(response.json()).toEqual({ error: 'invalid_content' })
    })

    it.each([
      'https://example.com/guide',
      'http://example.com/guide',
      'mailto:alice@example.com'
    ])('takes a link to %s', async href => {
      const alice = aUser()
      const wiki = await aWikiOf(api, alice)

      const response = await createPage(api, alice, wiki.id, {
        title: 'Onboarding',
        content: [linkingTo(href)]
      })

      expect(response.statusCode).toBe(201)
    })

    it.each([
      ['an image', 'image'],
      ['a video', 'video'],
      ['an audio block', 'audio'],
      ['a file', 'file']
    ])('takes %s at an https: address, or at none yet', async (_case, type) => {
      const alice = aUser()
      const wiki = await aWikiOf(api, alice)

      const response = await createPage(api, alice, wiki.id, {
        title: 'Onboarding',
        content: [
          anAddressed(type, 'https://example.com/desk'),
          anAddressed(type, '')
        ]
      })

      expect(response.statusCode).toBe(201)
    })

    it('takes a Grist embed on a Grist origin, or on none yet', async () => {
      const alice = aUser()
      const wiki = await aWikiOf(api, alice)

      const response = await createPage(api, alice, wiki.id, {
        title: 'Onboarding',
        content: [
          anAddressed('gristEmbed', `${GRIST_ORIGIN}/o/docs/4kq2/Tasks`),
          anAddressed('gristEmbed', '')
        ]
      })

      expect(response.statusCode).toBe(201)
    })

    const scriptLink = aLink('javascript:alert(1)')

    const gristHost = new URL(GRIST_ORIGIN).host

    it.each([
      ['a link to javascript:alert(1)', linkingTo('javascript:alert(1)')],
      [
        'a link to JavaScript:alert(1) after a space',
        linkingTo(' JavaScript:alert(1)')
      ],
      [
        'a link to data:text/html',
        linkingTo('data:text/html,<script>alert(1)</script>')
      ],
      [
        'a link to ftp://example.com/guide',
        linkingTo('ftp://example.com/guide')
      ],
      ['a link to /pages/guide', linkingTo('/pages/guide')],
      [
        'a link in a child block',
        aBlock('paragraph', {
          content: [styled('Steps')],
          children: [aBlock('bulletListItem', { content: [scriptLink] })]
        })
      ],
      [
        'a link in a table cell',
        aBlock('table', {
          content: {
            type: 'tableContent',
            columnWidths: [null],
            rows: [{ cells: [{ type: 'tableCell', content: [scriptLink] }] }]
          }
        })
      ],
      [
        'an image at an http: address',
        anAddressed('image', 'http://example.com/desk')
      ],
      [
        'a video at an http: address',
        anAddressed('video', 'http://example.com/desk')
      ],
      [
        'an audio block at an http: address',
        anAddressed('audio', 'http://example.com/desk')
      ],
      [
        'a file at an http: address',
        anAddressed('file', 'http://example.com/desk')
      ],
      [
        'an image at a data: address',
        anAddressed('image', 'data:image/png;base64,iVBORw0KGgo=')
      ],
      [
        'an image at a blob: address',
        anAddressed('image', 'blob:https://example.com/0d6c')
      ],
      ['an image at a path', anAddressed('image', '/files/desk.png')],
      ['an image at a number', anAddressed('image', 12)],
      [
        'a Grist embed on another origin',
        anAddressed('gristEmbed', 'https://docs.example.com/o/docs/4kq2')
      ],
      [
        'a Grist embed on a look-alike origin',
        anAddressed('gristEmbed', `${GRIST_ORIGIN}.example.net/o/docs/4kq2`)
      ],
      [
        'a Grist embed on the Grist host over http:',
        anAddressed('gristEmbed', `http://${gristHost}/o/docs/4kq2`)
      ],
      [
        'a Grist embed on another origin behind a user name',
        anAddressed('gristEmbed', `https://${gristHost}@docs.example.com/`)
      ],
      [
        'a Grist embed at no address at all',
        anAddressed('gristEmbed', 'Tasks')
      ],
      [
        'a NUL character in a text',
        aBlock('paragraph', { content: [styled('Steps\u0000')] })
      ],
      [
        'a lone surrogate in a text',
        aBlock('paragraph', { content: [styled('Steps \ud83d')] })
      ],
      [
        'a NUL character in a key',
        aBlock('heading', { props: { 'level\u0000': 2 } })
      ],
      [
        'a lone surrogate in a key',
        aBlock('heading', { props: { '\udc00level': 2 } })
      ]
    ])('answers invalid_content for %s', async (_case, block) => {
      const alice = aUser()
      const wiki = await aWikiOf(api, alice)

      const response = await createPage(api, alice, wiki.id, {
        title: 'Onboarding',
        content: [block]
      })

      expect(response.statusCode).toBe(400)
      expect(response.json()).toEqual({ error: 'invalid_content' })
    })

    it('stores nothing of a page whose blocks it refuses', async () => {
      const alice = aUser()
      const wiki = await aWikiOf(api, alice)
      const before = await versionOf(api, alice, wiki.id)

      await createPage(api, alice, wiki.id, {
        title: 'Onboarding',
        content: [linkingTo('javascript:alert(1)')]
      })

      expect(await titlesUnder(alice, wiki.id, null)).toEqual([])
      expect(await versionOf(api, alice, wiki.id)).toBe(before)
    })
  })
})

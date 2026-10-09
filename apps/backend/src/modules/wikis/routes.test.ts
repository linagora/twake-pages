import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest'
import { createDb } from '../../infra/db.ts'
import {
  aB2cUser,
  aPageIn,
  aSpaceWiki,
  aUser,
  aWikiOf,
  invite,
  joinWiki,
  purgeJobOf,
  startApp,
  wikiRowsOf,
  wikisOf,
  type TestUser
} from '../../testing/app.ts'
import { notify } from '../notifications/testing.ts'
import { purgeWiki } from './store.ts'

let api: Awaited<ReturnType<typeof startApp>>
let baseUrl: string
const { sql, db } = createDb(inject('databaseUrl'))

beforeAll(async () => {
  api = await startApp()
  baseUrl = await api.listen()
})

afterAll(async () => {
  await api.close()
  await sql.end()
})

const roles = async (user: TestUser) =>
  (await wikisOf(api, user)).map(wiki => [wiki.name, wiki.role])

// No policy shows the pages of a wiki that is gone: this counts them with the
// policies lifted, in a transaction that puts them back before it commits.
const pagesLeftIn = (wikiId: string) =>
  sql.begin(async tx => {
    await tx`alter table pages no force row level security`
    const [left] = await tx<{ count: number }[]>`
      select count(*)::int as count from pages where wiki_id = ${wikiId}`
    await tx`alter table pages force row level security`
    return left?.count
  })

describe('GET /wikis', () => {
  it('counts the person’s unread notifications about each wiki', async () => {
    const alice = aUser()
    const bob = aUser({ organizationId: alice.organizationId })
    const carol = aUser({ organizationId: alice.organizationId })
    const wiki = await aWikiOf(api, alice)
    await joinWiki(db, alice, wiki.id, bob, 'editor')
    await joinWiki(db, alice, wiki.id, carol, 'editor')
    await notify(db, alice, wiki, bob)
    await notify(db, alice, wiki, bob)
    await notify(db, alice, wiki, bob, new Date())
    await notify(db, alice, wiki, carol)

    const unread = (await wikisOf(api, bob)).map(listed => [
      listed.name,
      listed.unread
    ])

    expect(unread).toEqual([
      ['Personal', 0],
      ['Handbook', 2]
    ])
  })

  it.each([
    ['a B2B user', aUser()],
    ['a B2C user, who has no organization', aB2cUser()]
  ])('gives %s a personal wiki on first call', async (_case, user) => {
    const response = await api.as(user).get('/wikis')

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({
      wikis: [
        {
          id: expect.any(String) as string,
          name: 'Personal',
          description: '',
          kind: 'personal',
          role: 'admin',
          homePageId: expect.any(String) as string,
          unread: 0
        }
      ]
    })
  })

  it('has the person follow the home page of their personal wiki', async () => {
    const alice = aUser()
    const [personal] = await wikisOf(api, alice)

    const home = await api.as(alice).get(`/pages/${personal?.homePageId ?? ''}`)

    expect(home.json()).toMatchObject({ following: true })
  })

  it('keeps the same personal wiki on later calls', async () => {
    const alice = aUser()

    const [first] = await wikisOf(api, alice)
    const again = await wikisOf(api, alice)

    expect(again).toEqual([first])
  })

  it('lists the personal wiki first, then the others by name', async () => {
    const alice = aUser()
    await aWikiOf(api, alice, 'Zoning')
    await aWikiOf(api, alice, 'Archives')

    expect((await wikisOf(api, alice)).map(wiki => wiki.name)).toEqual([
      'Personal',
      'Archives',
      'Zoning'
    ])
  })

  it('turns the invites of the person’s email into memberships', async () => {
    const alice = aUser()
    const bob = aUser({
      organizationId: alice.organizationId,
      email: `Bob-${crypto.randomUUID()}@Example.com`
    })
    const wiki = await aWikiOf(api, alice)
    await invite(api, alice, wiki.id, bob.email)

    expect(await roles(bob)).toEqual([
      ['Personal', 'admin'],
      ['Handbook', 'editor']
    ])
  })

  it('claims an invite only in its own tenant', async () => {
    const alice = aUser()
    const carol = aB2cUser()
    const wiki = await aWikiOf(api, alice)
    const shared = await aWikiOf(api, carol, 'Recipes')
    const email = `dave-${crypto.randomUUID()}@example.com`
    await invite(api, alice, wiki.id, email)
    await invite(api, carol, shared.id, email)

    expect(await roles(aUser({ email }))).toEqual([['Personal', 'admin']])
    expect(await roles(aUser({ email, organizationId: null }))).toEqual([
      ['Personal', 'admin'],
      ['Recipes', 'editor']
    ])
  })

  it('asks for a bearer token', async () => {
    const response = await fetch(`${baseUrl}/api/wikis`)

    expect(response.status).toBe(401)
    expect(response.headers.get('www-authenticate')).toBe('Bearer')
  })
})

describe('POST /wikis', () => {
  it('creates a shared wiki whose creator is its admin', async () => {
    const alice = aB2cUser()

    const response = await api
      .as(alice)
      .post('/wikis', { name: '  Handbook ', description: 'How we work' })

    expect(response.statusCode).toBe(201)
    expect(response.json()).toEqual({
      id: expect.any(String) as string,
      name: 'Handbook',
      description: 'How we work',
      kind: 'shared',
      role: 'admin',
      homePageId: expect.any(String) as string,
      unread: 0,
      version: 0
    })
  })

  it('has the creator follow the home page', async () => {
    const alice = aUser()
    const wiki = await aWikiOf(api, alice)

    const home = await api.as(alice).get(`/pages/${wiki.homePageId}`)

    expect(home.json()).toMatchObject({ following: true })
  })

  it.each([
    ['no name', {}],
    ['a name that is no string', { name: 42 }],
    ['a blank name', { name: '   ' }],
    ['a name over 100 characters', { name: 'x'.repeat(101) }],
    ['a NUL character in the name', { name: 'Ops\u0000' }],
    [
      'a description over 500 characters',
      { name: 'Ops', description: 'x'.repeat(501) }
    ],
    [
      'a lone surrogate in the description',
      { name: 'Ops', description: 'Runbooks \ud83d' }
    ]
  ])('refuses %s', async (_case, body) => {
    const response = await api.as(aUser()).post('/wikis', body)

    expect(response.statusCode).toBe(400)
    expect(response.json()).toEqual({ error: 'invalid_request' })
  })
})

describe('GET /wikis/:wikiId', () => {
  it('shows a wiki to its members', async () => {
    const alice = aUser()
    const wiki = await aWikiOf(api, alice)

    const response = await api.as(alice).get(`/wikis/${wiki.id}`)

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual(wiki)
  })

  it.each(['viewer', 'editor'] as const)(
    'shows the wiki to its %ss, with their role',
    async role => {
      const alice = aUser()
      const bob = aUser({ organizationId: alice.organizationId })
      const wiki = await aWikiOf(api, alice)
      await joinWiki(db, alice, wiki.id, bob, role)

      const response = await api.as(bob).get(`/wikis/${wiki.id}`)

      expect(response.statusCode).toBe(200)
      expect(response.json()).toEqual({ ...wiki, role })
    }
  )

  it.each([
    ['someone of its organization who is no member', aUser(), true],
    ['someone of another organization', aUser(), false],
    ['a B2C user', aB2cUser(), false]
  ])('hides a wiki from %s', async (_case, stranger, colleague) => {
    const admin = colleague
      ? aUser({ organizationId: stranger.organizationId })
      : aUser()
    const wiki = await aWikiOf(api, admin)

    const response = await api.as(stranger).get(`/wikis/${wiki.id}`)

    expect(response.statusCode).toBe(404)
    expect(response.json()).toEqual({ error: 'not_found' })
  })

  it('hides the personal wiki of someone else of the organization', async () => {
    const alice = aUser()
    const [personal] = await wikisOf(api, alice)

    const response = await api
      .as(aUser({ organizationId: alice.organizationId }))
      .get(`/wikis/${personal?.id ?? ''}`)

    expect(response.statusCode).toBe(404)
  })

  it('answers not_found for an id that is no uuid', async () => {
    const response = await api.as(aUser()).get('/wikis/handbook')

    expect(response.statusCode).toBe(404)
    expect(response.json()).toEqual({ error: 'not_found' })
  })
})

describe('PATCH /wikis/:wikiId', () => {
  it('lets an admin rename and describe the wiki', async () => {
    const alice = aUser()
    const wiki = await aWikiOf(api, alice)

    const response = await api
      .as(alice)
      .patch(`/wikis/${wiki.id}`, { name: ' Guide ', description: 'All of it' })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({
      ...wiki,
      name: 'Guide',
      description: 'All of it',
      version: 1
    })
  })

  it.each(['editor', 'viewer'] as const)('refuses %ss', async role => {
    const alice = aUser()
    const bob = aUser({ organizationId: alice.organizationId })
    const wiki = await aWikiOf(api, alice)
    await joinWiki(db, alice, wiki.id, bob, role)

    const response = await api
      .as(bob)
      .patch(`/wikis/${wiki.id}`, { name: 'Guide' })

    expect(response.statusCode).toBe(403)
    expect(response.json()).toEqual({ error: 'forbidden' })
  })

  it('hides the wiki from someone who is no member', async () => {
    const alice = aUser()
    const wiki = await aWikiOf(api, alice)

    const response = await api
      .as(aUser({ organizationId: alice.organizationId }))
      .patch(`/wikis/${wiki.id}`, { name: 'Guide' })

    expect(response.statusCode).toBe(404)
    expect(response.json()).toEqual({ error: 'not_found' })
  })

  it('keeps the name of a space’s wiki, which comes from the space', async () => {
    const alice = aUser()
    const wikiId = await aSpaceWiki(db, [[alice, 'admin']])

    const renamed = await api
      .as(alice)
      .patch(`/wikis/${wikiId}`, { name: 'Guide' })
    const described = await api
      .as(alice)
      .patch(`/wikis/${wikiId}`, { description: 'Campaigns' })

    expect(renamed.statusCode).toBe(409)
    expect(renamed.json()).toEqual({ error: 'managed' })
    expect(described.json()).toMatchObject({
      name: 'Marketing',
      description: 'Campaigns',
      kind: 'space',
      version: 1
    })
  })

  it.each([
    ['an empty body', {}],
    ['a blank name', { name: ' ' }],
    ['a NUL character in the name', { name: 'Guide\u0000' }],
    ['a description over 500 characters', { description: 'x'.repeat(501) }],
    ['a lone surrogate in the description', { description: 'Runbooks \ud83d' }]
  ])('refuses %s', async (_case, body) => {
    const alice = aUser()
    const wiki = await aWikiOf(api, alice)

    const response = await api.as(alice).patch(`/wikis/${wiki.id}`, body)

    expect(response.statusCode).toBe(400)
    expect(response.json()).toEqual({ error: 'invalid_request' })
    expect((await api.as(alice).get(`/wikis/${wiki.id}`)).json()).toEqual(wiki)
  })
})

describe('DELETE /wikis/:wikiId', () => {
  it('puts a shared wiki out of reach, until its purge 30 days later', async () => {
    const alice = aUser()
    const wiki = await aWikiOf(api, alice)

    const response = await api.as(alice).delete(`/wikis/${wiki.id}`)

    expect(response.statusCode).toBe(204)
    expect((await api.as(alice).get(`/wikis/${wiki.id}`)).statusCode).toBe(404)
    expect((await wikisOf(api, alice)).map(listed => listed.name)).toEqual([
      'Personal'
    ])
    const job = await purgeJobOf(db, wiki.id)
    const days = (job.runAt.getTime() - Date.now()) / 86_400_000
    expect(Math.round(days)).toBe(30)
  })

  it('purges the wiki for good, with its pages', async () => {
    const alice = aB2cUser()
    const wiki = await aWikiOf(api, alice)
    const plans = await aPageIn(db, alice, wiki.id, {
      title: 'Plans',
      position: 'a0'
    })
    await aPageIn(db, alice, wiki.id, {
      title: 'Q1',
      position: 'a0',
      parentId: plans
    })
    await api.as(alice).delete(`/wikis/${wiki.id}`)
    const job = await purgeJobOf(db, wiki.id)
    expect(await pagesLeftIn(wiki.id)).toBe(3)

    await db.transaction(tx => purgeWiki(job.payload, tx))

    expect(await pagesLeftIn(wiki.id)).toBe(0)
    expect(await wikiRowsOf(db, alice, wiki.id)).toEqual([])
  })

  it.each([
    [
      'a personal wiki',
      async (alice: TestUser) => (await wikisOf(api, alice))[0]?.id ?? ''
    ],
    ['a space’s wiki', (alice: TestUser) => aSpaceWiki(db, [[alice, 'admin']])]
  ])('refuses to delete %s', async (_case, aWikiOfKind) => {
    const alice = aUser()
    const wikiId = await aWikiOfKind(alice)

    const response = await api.as(alice).delete(`/wikis/${wikiId}`)

    expect(response.statusCode).toBe(409)
    expect(response.json()).toEqual({ error: 'managed' })
    expect((await api.as(alice).get(`/wikis/${wikiId}`)).statusCode).toBe(200)
  })

  it.each(['editor', 'viewer'] as const)('refuses %ss', async role => {
    const alice = aUser()
    const bob = aUser({ organizationId: alice.organizationId })
    const wiki = await aWikiOf(api, alice)
    await joinWiki(db, alice, wiki.id, bob, role)

    const response = await api.as(bob).delete(`/wikis/${wiki.id}`)

    expect(response.statusCode).toBe(403)
    expect(response.json()).toEqual({ error: 'forbidden' })
  })
})

describe('GET /wikis/:wikiId/tree', () => {
  interface TreePage {
    id: string
    parentId: string | null
    position: string
    title: string
    kind: 'document' | 'database'
  }

  it('lists the live pages of the wiki, but its home page', async () => {
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
    const archive = await aPageIn(db, alice, wiki.id, {
      title: 'Archive',
      position: 'a1'
    })
    await aPageIn(db, alice, wiki.id, {
      title: 'Drafts',
      position: 'a2',
      deleted: true
    })

    const response = await api.as(alice).get(`/wikis/${wiki.id}/tree`)

    expect(response.statusCode).toBe(200)
    const tree = response.json<{ version: number; pages: TreePage[] }>()
    expect(tree.version).toBe(0)
    expect(
      tree.pages.toSorted((a, b) => a.title.localeCompare(b.title))
    ).toEqual([
      {
        id: archive,
        parentId: null,
        position: 'a1',
        title: 'Archive',
        kind: 'document'
      },
      {
        id: plans,
        parentId: null,
        position: 'a0',
        title: 'Plans',
        kind: 'document'
      },
      { id: q1, parentId: plans, position: 'a0', title: 'Q1', kind: 'document' }
    ])
  })

  it.each(['viewer', 'editor'] as const)(
    'shows the tree to the wiki’s %ss',
    async role => {
      const alice = aUser()
      const bob = aUser({ organizationId: alice.organizationId })
      const wiki = await aWikiOf(api, alice)
      const plans = await aPageIn(db, alice, wiki.id, {
        title: 'Plans',
        position: 'a0'
      })
      await joinWiki(db, alice, wiki.id, bob, role)

      const response = await api.as(bob).get(`/wikis/${wiki.id}/tree`)

      expect(response.statusCode).toBe(200)
      expect(response.json()).toEqual({
        version: 0,
        pages: [
          {
            id: plans,
            parentId: null,
            position: 'a0',
            title: 'Plans',
            kind: 'document'
          }
        ]
      })
    }
  )

  it('hides the tree from someone who is no member', async () => {
    const alice = aUser()
    const wiki = await aWikiOf(api, alice)

    const response = await api
      .as(aUser({ organizationId: alice.organizationId }))
      .get(`/wikis/${wiki.id}/tree`)

    expect(response.statusCode).toBe(404)
    expect(response.json()).toEqual({ error: 'not_found' })
  })

  it('hides the tree of a deleted wiki, even from its admin', async () => {
    const alice = aUser()
    const wiki = await aWikiOf(api, alice)
    await api.as(alice).delete(`/wikis/${wiki.id}`)

    const response = await api.as(alice).get(`/wikis/${wiki.id}/tree`)

    expect(response.statusCode).toBe(404)
  })
})

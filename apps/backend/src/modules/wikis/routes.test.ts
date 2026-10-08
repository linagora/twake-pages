import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest'
import { createDb, inTenant } from '../../infra/db.ts'
import {
  aB2cUser,
  aSpaceWiki,
  aUser,
  joinWiki,
  startApp,
  type TestUser
} from '../../testing/app.ts'
import { wikiInvites } from './schema.ts'

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

interface WikiSummary {
  id: string
  name: string
  description: string
  kind: 'personal' | 'shared' | 'space'
  role: 'viewer' | 'editor' | 'admin'
  homePageId: string
  unread: number
}

interface Wiki extends WikiSummary {
  version: number
}

const wikisOf = async (user: TestUser) =>
  (await api.as(user).get('/wikis')).json<{ wikis: WikiSummary[] }>().wikis

const aWikiOf = async (owner: TestUser, name = 'Handbook') =>
  (await api.as(owner).post('/wikis', { name })).json<Wiki>()

const roles = async (user: TestUser) =>
  (await wikisOf(user)).map(wiki => [wiki.name, wiki.role])

// Sharing is not served yet, so invites are written as it will write them.
const invite = (admin: TestUser, wikiId: string, email: string) =>
  inTenant(db, admin, tx =>
    tx.insert(wikiInvites).values({
      wikiId,
      organizationId: admin.organizationId,
      email: email.toLowerCase(),
      role: 'editor',
      invitedBy: admin.userId
    })
  )

describe('GET /wikis', () => {
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

  it('keeps the same personal wiki on later calls', async () => {
    const alice = aUser()

    const [first] = await wikisOf(alice)
    const again = await wikisOf(alice)

    expect(again).toEqual([first])
  })

  it('lists the personal wiki first, then the others by name', async () => {
    const alice = aUser()
    await aWikiOf(alice, 'Zoning')
    await aWikiOf(alice, 'Archives')

    expect((await wikisOf(alice)).map(wiki => wiki.name)).toEqual([
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
    const wiki = await aWikiOf(alice)
    await invite(alice, wiki.id, bob.email)

    expect(await roles(bob)).toEqual([
      ['Personal', 'admin'],
      ['Handbook', 'editor']
    ])
  })

  it('claims an invite only in its own tenant', async () => {
    const alice = aUser()
    const carol = aB2cUser()
    const wiki = await aWikiOf(alice)
    const shared = await aWikiOf(carol, 'Recipes')
    const email = `dave-${crypto.randomUUID()}@example.com`
    await invite(alice, wiki.id, email)
    await invite(carol, shared.id, email)

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

  it.each([
    ['no name', {}],
    ['a name that is no string', { name: 42 }],
    ['a blank name', { name: '   ' }],
    ['a name over 100 characters', { name: 'x'.repeat(101) }],
    [
      'a description over 500 characters',
      { name: 'Ops', description: 'x'.repeat(501) }
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
    const wiki = await aWikiOf(alice)

    const response = await api.as(alice).get(`/wikis/${wiki.id}`)

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual(wiki)
  })

  it.each([
    ['someone of its organization who is no member', aUser(), true],
    ['someone of another organization', aUser(), false],
    ['a B2C user', aB2cUser(), false]
  ])('hides a wiki from %s', async (_case, stranger, colleague) => {
    const owner = colleague
      ? aUser({ organizationId: stranger.organizationId })
      : aUser()
    const wiki = await aWikiOf(owner)

    const response = await api.as(stranger).get(`/wikis/${wiki.id}`)

    expect(response.statusCode).toBe(404)
    expect(response.json()).toEqual({ error: 'not_found' })
  })

  it('hides the personal wiki of someone else of the organization', async () => {
    const alice = aUser()
    const [personal] = await wikisOf(alice)

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
    const wiki = await aWikiOf(alice)

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

  it.each(['editor', 'viewer'] as const)('refuses an %s', async role => {
    const alice = aUser()
    const bob = aUser({ organizationId: alice.organizationId })
    const wiki = await aWikiOf(alice)
    await joinWiki(db, alice, wiki.id, bob, role)

    const response = await api
      .as(bob)
      .patch(`/wikis/${wiki.id}`, { name: 'Guide' })

    expect(response.statusCode).toBe(403)
    expect(response.json()).toEqual({ error: 'forbidden' })
  })

  it('hides the wiki from someone who is no member', async () => {
    const alice = aUser()
    const wiki = await aWikiOf(alice)

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
    ['a description over 500 characters', { description: 'x'.repeat(501) }]
  ])('refuses %s', async (_case, body) => {
    const alice = aUser()
    const wiki = await aWikiOf(alice)

    const response = await api.as(alice).patch(`/wikis/${wiki.id}`, body)

    expect(response.statusCode).toBe(400)
    expect(response.json()).toEqual({ error: 'invalid_request' })
  })
})

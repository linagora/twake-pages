import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { aB2cUser, aUser, startApp, type TestUser } from '../../testing/app.ts'

let api: Awaited<ReturnType<typeof startApp>>
let baseUrl: string

beforeAll(async () => {
  api = await startApp()
  baseUrl = await api.listen()
})

afterAll(async () => {
  await api.close()
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

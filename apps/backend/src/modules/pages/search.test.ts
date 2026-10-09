import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest'
import { createDb } from '../../infra/db.ts'
import {
  aPage,
  aPageIn,
  aUser,
  aWikiOf,
  joinWiki,
  malformedOrUnknownIds,
  pageOf,
  pagesIn,
  paragraph,
  personalWikiOf,
  publish,
  startApp,
  waysOutOfAWiki,
  type PageRef,
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

/** A page as `GET /search` finds it. */
interface SearchResult {
  page: PageRef
  markedTitle: string
  excerpt: string
  updatedAt: string
}

const search = (user: TestUser, query: Record<string, string>) =>
  api.as(user).get(`/search?${new URLSearchParams(query).toString()}`)

const resultsOf = async (user: TestUser, query: Record<string, string>) =>
  (await search(user, query)).json<{ results: SearchResult[] }>().results

const titlesFound = async (user: TestUser, q: string) =>
  (await resultsOf(user, { q })).map(result => result.page.title)

// The contract's markers of a word found in a title or an excerpt.
const FOUND_START = String.fromCharCode(0xe000)
const FOUND_END = String.fromCharCode(0xe001)

const found = (word: string) => `${FOUND_START}${word}${FOUND_END}`

/** A person's wiki with "Onboarding", which tells to bring a badge. */
async function anOnboardingWiki() {
  const alice = aUser()
  const wiki = await aWikiOf(api, alice)
  const onboarding = await aPage(api, alice, wiki.id, {
    title: 'Onboarding',
    content: [paragraph('Bring your badge and a smile on the first day.')]
  })
  return { alice, wiki, onboarding }
}

describe('search', () => {
  it('finds a page by a word of its text, with its wiki, when it was last published, and the word marked in an excerpt', async () => {
    const alice = aUser()
    const wiki = await aWikiOf(api, alice, 'Handbook')
    const onboarding = await aPage(api, alice, wiki.id, {
      title: 'Onboarding',
      content: [paragraph('Bring your badge on the first day.')]
    })

    const results = await resultsOf(alice, { q: 'badge' })

    expect(results).toEqual([
      {
        page: {
          id: onboarding,
          title: 'Onboarding',
          wiki: { id: wiki.id, name: 'Handbook', kind: 'shared' }
        },
        markedTitle: 'Onboarding',
        excerpt: `Bring your ${found('badge')} on the first day.`,
        updatedAt: (await pageOf(api, alice, onboarding)).updatedAt
      }
    ])
  })

  it('finds a page by a word of its title, marked there, with an empty excerpt, above a later page whose text alone holds the word and more words it begins', async () => {
    const alice = aUser()
    const wiki = await aWikiOf(api, alice)
    await aPage(api, alice, wiki.id, {
      title: 'Badge requests',
      content: [
        paragraph('Ask the front desk for a new one, with your name and team.')
      ]
    })
    await aPage(api, alice, wiki.id, {
      title: 'Onboarding',
      content: [paragraph('Bring your badge: badges and a badger.')]
    })

    const results = await resultsOf(alice, { q: 'badge' })

    expect(results.map(result => result.page.title)).toEqual([
      'Badge requests',
      'Onboarding'
    ])
    expect(results[0]).toMatchObject({
      markedTitle: `${found('Badge')} requests`,
      excerpt: ''
    })
  })

  it('ranks a page whose title holds one of the words above a page whose text alone holds them all, side by side', async () => {
    const alice = aUser()
    const wiki = await aWikiOf(api, alice)
    await aPage(api, alice, wiki.id, {
      title: 'Onboarding',
      content: [paragraph(`${'Read this first. '.repeat(50)}Bring your badge.`)]
    })
    await aPage(api, alice, wiki.id, {
      title: 'First day',
      content: [paragraph('Your onboarding badge opens every door.')]
    })

    expect(await titlesFound(alice, 'onboarding badge')).toEqual([
      'Onboarding',
      'First day'
    ])
  })

  it('ranks the pages whose titles hold as many of the words with ts_rank, the last published first among equals', async () => {
    const alice = aUser()
    const wiki = await aWikiOf(api, alice)
    await aPage(api, alice, wiki.id, {
      title: 'Desk',
      content: [paragraph('A badge, a spare badge and a lost badge.')]
    })
    await aPage(api, alice, wiki.id, {
      title: 'Lobby',
      content: [paragraph('Show your badge.')]
    })
    await aPage(api, alice, wiki.id, {
      title: 'Hall',
      content: [paragraph('Wear your badge.')]
    })

    expect(await titlesFound(alice, 'badge')).toEqual(['Desk', 'Hall', 'Lobby'])
  })

  it('finds a page without text, with an empty excerpt', async () => {
    const alice = aUser()
    const wiki = await aWikiOf(api, alice, 'Handbook')

    const results = await resultsOf(alice, { q: 'handbook' })

    expect(results).toEqual([
      {
        page: {
          id: wiki.homePageId,
          title: 'Handbook',
          wiki: { id: wiki.id, name: 'Handbook', kind: 'shared' }
        },
        markedTitle: found('Handbook'),
        excerpt: '',
        updatedAt: expect.any(String) as string
      }
    ])
  })

  it('finds the pages with every word, whatever their case, the last one as the beginning of a word', async () => {
    const { alice } = await anOnboardingWiki()

    expect(await titlesFound(alice, 'YOUR Badge')).toEqual(['Onboarding'])
    expect(await titlesFound(alice, 'your bad')).toEqual(['Onboarding'])
    expect(await titlesFound(alice, 'yo badge')).toEqual([])
    expect(await titlesFound(alice, 'your badge laptop')).toEqual([])
  })

  it.each([
    '"badge" \'smile\'',
    'badge & (smile | day)',
    '!badge <-> smile',
    'badge:* smile:A',
    "\\badge: ''smile",
    'badge * day?'
  ])(
    'searches what full text search reads as operators as text: %s',
    async q => {
      const { alice } = await anOnboardingWiki()

      const response = await search(alice, { q })

      expect(response.statusCode).toBe(200)
      expect(
        response
          .json<{ results: SearchResult[] }>()
          .results.map(result => result.page.title)
      ).toEqual(['Onboarding'])
    }
  )

  it('finds nothing for text without a word', async () => {
    const { alice } = await anOnboardingWiki()

    const response = await search(alice, { q: '&|!:*()\'"\\<->' })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ results: [] })
  })

  it('finds an email, an address and a version number whole, as a page holds them, and a hyphenated word by its parts', async () => {
    const alice = aUser()
    const wiki = await aWikiOf(api, alice)
    await aPage(api, alice, wiki.id, {
      title: 'Support',
      content: [
        paragraph(
          "Read the on-call guide at docs.example.com/it's/here?lang=fr&theme=dark for release 1.2.3, or write to help@example.com, or call desk.example.com:8443."
        )
      ]
    })

    for (const q of [
      'help@example.com',
      "docs.example.com/it's/here?lang=fr&theme=dark",
      'desk.example.com:8443',
      '1.2.3',
      'on-call',
      'on-ca'
    ]) {
      expect(await titlesFound(alice, q), q).toEqual(['Support'])
    }
  })

  it('searches the title and the text of the current version of a page', async () => {
    const { alice, onboarding } = await anOnboardingWiki()
    await publish(api, alice, onboarding, {
      baseVersion: 1,
      title: 'Welcome',
      content: [paragraph('Bring a laptop.')]
    })

    const results = await resultsOf(alice, { q: 'laptop' })

    expect(results).toEqual([
      expect.objectContaining({
        page: expect.objectContaining({ title: 'Welcome' }) as PageRef,
        excerpt: `Bring a ${found('laptop')}.`,
        updatedAt: (await pageOf(api, alice, onboarding)).updatedAt
      })
    ])
    expect(await titlesFound(alice, 'badge')).toEqual([])
    expect(await titlesFound(alice, 'onboarding')).toEqual([])
  })

  it('quotes five words before the first word found and eight after, every word found marked, the lines of the text run together', async () => {
    const alice = aUser()
    const wiki = await aWikiOf(api, alice)
    await aPage(api, alice, wiki.id, {
      title: 'Onboarding',
      content: [
        paragraph('Before the first day, IT prepares your laptop and your'),
        paragraph(
          'badge, which you collect with the badges form at the front desk.'
        )
      ]
    })

    const [result] = await resultsOf(alice, { q: 'badge' })

    expect(result?.excerpt).toBe(
      `…prepares your laptop and your ${found('badge')}, which you collect with the ${found('badges')} form at…`
    )
  })

  it('quotes the text as written, what looks like markup too, but never a marker of its own', async () => {
    const alice = aUser()
    const wiki = await aWikiOf(api, alice)
    await aPage(api, alice, wiki.id, {
      title: 'Markup',
      content: [paragraph('The key: <details> of List<T> & <b>bold</b>.')]
    })
    await aPage(api, alice, wiki.id, {
      title: 'Markers',
      content: [paragraph(`The key, not the ${found('badge')} you wear.`)]
    })

    const results = await resultsOf(alice, { q: 'key' })

    expect(
      Object.fromEntries(
        results.map(result => [result.page.title, result.excerpt])
      )
    ).toEqual({
      Markup: `The ${found('key')}: <details> of List<T> & <b>bold</b>.`,
      Markers: `The ${found('key')}, not the badge you wear.`
    })
  })

  it('marks the title as written, what looks like markup too, but never a marker of its own', async () => {
    const alice = aUser()
    const wiki = await aWikiOf(api, alice)
    await aPage(api, alice, wiki.id, {
      title: `Key <b>facts</b>: keys, not ${found('badges')}`
    })

    const [result] = await resultsOf(alice, { q: 'key' })

    expect(result?.markedTitle).toBe(
      `${found('Key')} <b>facts</b>: ${found('keys')}, not  badges `
    )
  })

  it('lists the 50 best pages', async () => {
    const alice = aUser()
    const wiki = await aWikiOf(api, alice)
    const titled = await pagesIn(
      db,
      alice,
      wiki.id,
      50,
      position => `Badge ${position}`
    )
    await aPage(api, alice, wiki.id, {
      title: 'Onboarding',
      content: [paragraph('Bring your badge.')]
    })

    const results = await resultsOf(alice, { q: 'badge' })

    expect(results.map(result => result.page.id).sort()).toEqual(titled.sort())
  })

  it('searches every wiki the person is a member of, their personal wiki among them', async () => {
    const alice = aUser()
    const carol = aUser({ organizationId: alice.organizationId })
    const personal = await personalWikiOf(api, alice)
    const handbook = await aWikiOf(api, alice, 'Handbook')
    const plans = await aWikiOf(api, carol, 'Plans')
    await joinWiki(db, carol, plans.id, alice, 'viewer')
    await aPage(api, alice, personal.id, { title: 'Badges' })
    await aPage(api, alice, handbook.id, { title: 'Badges' })
    await aPage(api, carol, plans.id, { title: 'Badges' })

    const results = await resultsOf(alice, { q: 'badges' })

    expect(results.map(result => result.page.wiki)).toEqual([
      { id: plans.id, name: 'Plans', kind: 'shared' },
      { id: handbook.id, name: 'Handbook', kind: 'shared' },
      { id: personal.id, name: 'Personal', kind: 'personal' }
    ])
  })

  it('finds no page of a wiki the person is no member of', async () => {
    const { alice } = await anOnboardingWiki()
    const bob = aUser({ organizationId: alice.organizationId })

    expect(await titlesFound(bob, 'badge')).toEqual([])
  })

  it.each(waysOutOfAWiki)(
    'finds no page of %s',
    async (_case, someone, takeOut) => {
      const alice = someone()
      const carol = aUser({ organizationId: alice.organizationId })
      const wiki = await aWikiOf(api, carol)
      await joinWiki(db, carol, wiki.id, alice, 'viewer')
      await aPage(api, carol, wiki.id, {
        title: 'Onboarding',
        content: [paragraph('Bring your badge.')]
      })
      expect(await titlesFound(alice, 'badge')).toEqual(['Onboarding'])

      await takeOut(api, db, carol, wiki.id, alice)

      expect(await titlesFound(alice, 'badge')).toEqual([])
    }
  )

  it('finds no page in the trash', async () => {
    const alice = aUser()
    const wiki = await aWikiOf(api, alice)
    await aPageIn(db, alice, wiki.id, {
      title: 'Badges',
      position: 'a0',
      deleted: true
    })
    await aPageIn(db, alice, wiki.id, {
      title: 'Badge requests',
      position: 'a1'
    })

    expect(await titlesFound(alice, 'badge')).toEqual(['Badge requests'])
  })

  it('searches the wiki alone that wikiId names', async () => {
    const { alice, wiki } = await anOnboardingWiki()
    const other = await aWikiOf(api, alice, 'Other')
    await aPage(api, alice, other.id, { title: 'Badge requests' })

    const results = await resultsOf(alice, { q: 'badge', wikiId: wiki.id })

    expect(results.map(result => result.page.title)).toEqual(['Onboarding'])
  })

  it('answers not_found for a wiki the person is no member of', async () => {
    const alice = aUser()
    const wiki = await aWikiOf(
      api,
      aUser({ organizationId: alice.organizationId })
    )

    const response = await search(alice, { q: 'badge', wikiId: wiki.id })

    expect(response.statusCode).toBe(404)
    expect(response.json()).toEqual({ error: 'not_found' })
  })

  it.each(malformedOrUnknownIds)(
    'answers not_found for a wiki with %s',
    async (_case, wikiId) => {
      const response = await search(aUser(), { q: 'badge', wikiId })

      expect(response.statusCode).toBe(404)
      expect(response.json()).toEqual({ error: 'not_found' })
    }
  )

  it.each(waysOutOfAWiki)(
    'answers not_found for %s, named by wikiId',
    async (_case, someone, takeOut) => {
      const alice = someone()
      const carol = aUser({ organizationId: alice.organizationId })
      const wiki = await aWikiOf(api, carol)
      await joinWiki(db, carol, wiki.id, alice, 'viewer')
      expect(
        (await search(alice, { q: 'badge', wikiId: wiki.id })).statusCode
      ).toBe(200)

      await takeOut(api, db, carol, wiki.id, alice)

      const response = await search(alice, { q: 'badge', wikiId: wiki.id })
      expect(response.statusCode).toBe(404)
      expect(response.json()).toEqual({ error: 'not_found' })
    }
  )

  it.each<[string, Record<string, string>]>([
    ['no text', {}],
    ['blank text', { q: ' \t ' }],
    ['text over 200 characters', { q: 'b'.repeat(201) }],
    ['a NUL character', { q: `badge${String.fromCharCode(0)}` }]
  ])('answers invalid_request for %s', async (_case, query) => {
    const response = await search(aUser(), query)

    expect(response.statusCode).toBe(400)
    expect(response.json()).toEqual({ error: 'invalid_request' })
  })

  it('reads 200 characters, once trimmed', async () => {
    const { alice } = await anOnboardingWiki()
    const q = `${'badge '.repeat(33)}sm`

    expect(q).toHaveLength(200)
    expect(await titlesFound(alice, `  ${q}  `)).toEqual(['Onboarding'])
  })

  it('checks the text before the wiki', async () => {
    const response = await search(aUser(), { q: ' ', wikiId: randomUUID() })

    expect(response.statusCode).toBe(400)
    expect(response.json()).toEqual({ error: 'invalid_request' })
  })
})

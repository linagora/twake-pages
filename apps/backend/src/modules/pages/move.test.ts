import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest'
import { createDb } from '../../infra/db.ts'
import {
  aPage,
  aPageIn,
  aUser,
  aWikiOf,
  INVALID_PARENTS,
  joinWiki,
  malformedOrUnknownIds,
  movePage,
  neighbourPagesIn,
  placeOf,
  someoneOfEachTenant,
  STALE_NEIGHBOURS,
  startApp,
  titlesUnder,
  versionOf,
  type NeighbourPages
} from '../../testing/app.ts'
import { behindAChange } from '../wikis/testing.ts'
import type { PageMove } from './store.ts'

let api: Awaited<ReturnType<typeof startApp>>
const { sql, db } = createDb(inject('databaseUrl'))

beforeAll(async () => {
  api = await startApp()
})

afterAll(async () => {
  await api.close()
  await sql.end()
})

describe('POST /pages/:pageId/move', () => {
  it.each(someoneOfEachTenant)(
    'moves a page with its child pages under another page, %s',
    async (_case, someone) => {
      const alice = someone()
      const wiki = await aWikiOf(api, alice)
      const onboarding = await aPage(api, alice, wiki.id, {
        title: 'Onboarding'
      })
      const laptop = await aPage(api, alice, wiki.id, {
        title: 'Laptop setup'
      })
      await aPage(api, alice, wiki.id, { title: 'Accounts', parentId: laptop })

      const response = await movePage(api, alice, laptop, {
        parentId: onboarding
      })

      expect(response.statusCode).toBe(200)
      expect(response.json()).toEqual(
        await placeOf(api, alice, wiki.id, laptop)
      )
      expect(await titlesUnder(api, alice, wiki.id, null)).toEqual([
        'Onboarding'
      ])
      expect(await titlesUnder(api, alice, wiki.id, onboarding)).toEqual([
        'Laptop setup'
      ])
      expect(await titlesUnder(api, alice, wiki.id, laptop)).toEqual([
        'Accounts'
      ])
    }
  )

  it('moves the wiki’s version, so every open tree shows the move', async () => {
    const alice = aUser()
    const wiki = await aWikiOf(api, alice)
    const onboarding = await aPage(api, alice, wiki.id, { title: 'Onboarding' })
    const laptop = await aPage(api, alice, wiki.id, { title: 'Laptop setup' })
    const before = await versionOf(api, alice, wiki.id)

    await movePage(api, alice, laptop, { parentId: onboarding })

    expect(await versionOf(api, alice, wiki.id)).toBeGreaterThan(before)
  })

  type Neighbours = (siblings: {
    plans: string
    goals: string
  }) => Omit<PageMove, 'parentId'>

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
  ])(
    'places a page moved to the top of the tree %s',
    async (_case, neighbours, titles) => {
      const alice = aUser()
      const wiki = await aWikiOf(api, alice)
      const plans = await aPage(api, alice, wiki.id, { title: 'Plans' })
      const goals = await aPage(api, alice, wiki.id, { title: 'Goals' })
      const onboarding = await aPage(api, alice, wiki.id, {
        title: 'Onboarding',
        parentId: goals
      })

      const response = await movePage(api, alice, onboarding, {
        parentId: null,
        ...neighbours({ plans, goals })
      })

      expect(response.statusCode).toBe(200)
      expect(await titlesUnder(api, alice, wiki.id, null)).toEqual(titles)
    }
  )

  it('moves a page among its siblings', async () => {
    const alice = aUser()
    const wiki = await aWikiOf(api, alice)
    const plans = await aPage(api, alice, wiki.id, { title: 'Plans' })
    const goals = await aPage(api, alice, wiki.id, { title: 'Goals' })
    await aPage(api, alice, wiki.id, { title: 'Onboarding' })

    await movePage(api, alice, plans, { parentId: null, afterId: goals })

    expect(await titlesUnder(api, alice, wiki.id, null)).toEqual([
      'Goals',
      'Plans',
      'Onboarding'
    ])
  })

  it('takes the neighbours a page has once it is lifted out', async () => {
    const alice = aUser()
    const wiki = await aWikiOf(api, alice)
    const plans = await aPage(api, alice, wiki.id, { title: 'Plans' })
    const goals = await aPage(api, alice, wiki.id, { title: 'Goals' })
    const onboarding = await aPage(api, alice, wiki.id, { title: 'Onboarding' })

    const response = await movePage(api, alice, goals, {
      parentId: null,
      afterId: plans,
      beforeId: onboarding
    })

    expect(response.statusCode).toBe(200)
    expect(await titlesUnder(api, alice, wiki.id, null)).toEqual([
      'Plans',
      'Goals',
      'Onboarding'
    ])
  })

  it.each(INVALID_PARENTS)(
    'answers invalid_parent for %s',
    async (_case, parentOf) => {
      const alice = aUser()
      const wiki = await aWikiOf(api, alice)
      const parentId = await parentOf({ app: api, db, user: alice, wiki })
      const laptop = await aPage(api, alice, wiki.id, { title: 'Laptop setup' })
      const before = await versionOf(api, alice, wiki.id)

      const response = await movePage(api, alice, laptop, { parentId })

      expect(response.statusCode).toBe(400)
      expect(response.json()).toEqual({ error: 'invalid_parent' })
      expect(await versionOf(api, alice, wiki.id)).toBe(before)
    }
  )

  type InBranch = (branch: {
    laptop: string
    accounts: string
    vpn: string
  }) => string

  it.each<[string, InBranch]>([
    ['the page itself', ({ laptop }) => laptop],
    ['one of its child pages', ({ accounts }) => accounts],
    ['a descendant further down', ({ vpn }) => vpn]
  ])('answers invalid_parent for %s', async (_case, parentOf) => {
    const alice = aUser()
    const wiki = await aWikiOf(api, alice)
    const laptop = await aPage(api, alice, wiki.id, { title: 'Laptop setup' })
    const accounts = await aPage(api, alice, wiki.id, {
      title: 'Accounts',
      parentId: laptop
    })
    const vpn = await aPage(api, alice, wiki.id, {
      title: 'VPN',
      parentId: accounts
    })
    const before = await versionOf(api, alice, wiki.id)

    const response = await movePage(api, alice, laptop, {
      parentId: parentOf({ laptop, accounts, vpn })
    })

    expect(response.statusCode).toBe(400)
    expect(response.json()).toEqual({ error: 'invalid_parent' })
    expect(await versionOf(api, alice, wiki.id)).toBe(before)
  })

  // Each move waits for the wiki's row lock, which the change holds, then
  // reads the tree as the move before it left it.
  it('never makes a page its own ancestor when two moves cross', async () => {
    const alice = aUser()
    const bob = aUser({ organizationId: alice.organizationId })
    const wiki = await aWikiOf(api, alice)
    await joinWiki(db, alice, wiki.id, bob, 'editor')
    const plans = await aPage(api, alice, wiki.id, { title: 'Plans' })
    const goals = await aPage(api, alice, wiki.id, { title: 'Goals' })
    const before = await versionOf(api, alice, wiki.id)

    const [first, second] = await behindAChange(db, alice, wiki.id, [
      () => movePage(api, alice, plans, { parentId: goals }),
      () => movePage(api, bob, goals, { parentId: plans })
    ])

    expect(first?.statusCode).toBe(200)
    expect(second?.statusCode).toBe(400)
    expect(second?.json()).toEqual({ error: 'invalid_parent' })
    // Moved by the first move, never by the refused one.
    expect(await versionOf(api, alice, wiki.id)).toBe(before + 1)
    expect(await titlesUnder(api, alice, wiki.id, null)).toEqual(['Goals'])
    expect(await titlesUnder(api, alice, wiki.id, goals)).toEqual(['Plans'])
  })

  type StaleNeighbours = (
    pages: NeighbourPages & { laptop: string }
  ) => Omit<PageMove, 'parentId'>

  it.each<[string, StaleNeighbours]>([
    ...STALE_NEIGHBOURS,
    ['the page itself', ({ laptop }) => ({ afterId: laptop })]
  ])('answers stale_neighbours for %s', async (_case, neighbours) => {
    const alice = aUser()
    const wiki = await aWikiOf(api, alice)
    const neighbourPages = await neighbourPagesIn(api, db, alice, wiki.id)
    const laptop = await aPage(api, alice, wiki.id, { title: 'Laptop setup' })
    const before = await versionOf(api, alice, wiki.id)

    const response = await movePage(api, alice, laptop, {
      parentId: null,
      ...neighbours({ ...neighbourPages, laptop })
    })

    expect(response.statusCode).toBe(409)
    expect(response.json()).toEqual({ error: 'stale_neighbours' })
    expect(await versionOf(api, alice, wiki.id)).toBe(before)
  })

  it('answers home_page for the home page, which never moves', async () => {
    const alice = aUser()
    const wiki = await aWikiOf(api, alice)
    const before = await versionOf(api, alice, wiki.id)

    const response = await movePage(api, alice, wiki.homePageId, {
      parentId: null
    })

    expect(response.statusCode).toBe(409)
    expect(response.json()).toEqual({ error: 'home_page' })
    expect(await versionOf(api, alice, wiki.id)).toBe(before)
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

    const response = await movePage(api, alice, drafts, { parentId: null })

    expect(response.statusCode).toBe(409)
    expect(response.json()).toEqual({ error: 'in_trash' })
    expect(await versionOf(api, alice, wiki.id)).toBe(before)
  })

  it('lets an editor of the wiki move a page', async () => {
    const alice = aUser()
    const bob = aUser({ organizationId: alice.organizationId })
    const wiki = await aWikiOf(api, alice)
    await joinWiki(db, alice, wiki.id, bob, 'editor')
    const onboarding = await aPage(api, alice, wiki.id, { title: 'Onboarding' })
    const laptop = await aPage(api, alice, wiki.id, { title: 'Laptop setup' })

    const response = await movePage(api, bob, laptop, { parentId: onboarding })

    expect(response.statusCode).toBe(200)
    expect(await titlesUnder(api, alice, wiki.id, onboarding)).toEqual([
      'Laptop setup'
    ])
  })

  it('answers forbidden to a viewer of the wiki', async () => {
    const alice = aUser()
    const bob = aUser({ organizationId: alice.organizationId })
    const wiki = await aWikiOf(api, alice)
    await joinWiki(db, alice, wiki.id, bob, 'viewer')
    const onboarding = await aPage(api, alice, wiki.id, { title: 'Onboarding' })
    const laptop = await aPage(api, alice, wiki.id, { title: 'Laptop setup' })
    const before = await versionOf(api, alice, wiki.id)

    const response = await movePage(api, bob, laptop, { parentId: onboarding })

    expect(response.statusCode).toBe(403)
    expect(response.json()).toEqual({ error: 'forbidden' })
    expect(await versionOf(api, alice, wiki.id)).toBe(before)
  })

  it('answers not_found to someone who is no member', async () => {
    const alice = aUser()
    const outsider = aUser({ organizationId: alice.organizationId })
    const wiki = await aWikiOf(api, alice)
    const laptop = await aPage(api, alice, wiki.id, { title: 'Laptop setup' })
    const before = await versionOf(api, alice, wiki.id)

    const response = await movePage(api, outsider, laptop, { parentId: null })

    expect(response.statusCode).toBe(404)
    expect(response.json()).toEqual({ error: 'not_found' })
    expect(await versionOf(api, alice, wiki.id)).toBe(before)
  })

  it('answers not_found once the wiki is deleted', async () => {
    const alice = aUser()
    const wiki = await aWikiOf(api, alice)
    const laptop = await aPage(api, alice, wiki.id, { title: 'Laptop setup' })
    await api.as(alice).delete(`/wikis/${wiki.id}`)

    const response = await movePage(api, alice, laptop, { parentId: null })

    expect(response.statusCode).toBe(404)
    expect(response.json()).toEqual({ error: 'not_found' })
  })

  it.each(malformedOrUnknownIds)(
    'answers not_found for a page with %s',
    async (_case, pageId) => {
      const response = await movePage(api, aUser(), pageId, { parentId: null })

      expect(response.statusCode).toBe(404)
      expect(response.json()).toEqual({ error: 'not_found' })
    }
  )

  it.each([
    ['no parent', {}],
    ['a malformed parent', { parentId: 'not-an-id' }],
    ['a malformed neighbour', { parentId: null, afterId: 'a0' }]
  ])('answers invalid_request for %s', async (_case, body) => {
    const alice = aUser()
    const wiki = await aWikiOf(api, alice)
    const laptop = await aPage(api, alice, wiki.id, { title: 'Laptop setup' })
    const before = await versionOf(api, alice, wiki.id)

    const response = await api.as(alice).post(`/pages/${laptop}/move`, body)

    expect(response.statusCode).toBe(400)
    expect(response.json()).toEqual({ error: 'invalid_request' })
    expect(await versionOf(api, alice, wiki.id)).toBe(before)
  })
})

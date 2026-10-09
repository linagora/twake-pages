import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest'
import { createDb } from '../../infra/db.ts'
import {
  aPage,
  aPageIn,
  aUser,
  aWikiOf,
  GRIST_ORIGIN,
  joinWiki,
  malformedOrUnknownIds,
  paragraph,
  personOf,
  publish,
  startApp,
  waysOutOfAWiki,
  type Page,
  type Person,
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

/** A version as the history of its page lists it. */
interface VersionSummary {
  number: number
  title: string
  author: Person
  createdAt: string
  restoredFrom: number | null
}

/** What names no version of a page at its version 2. */
const numbersOfNoVersion: [string, string][] = [
  ['a number past the last version', '3'],
  ['0', '0'],
  ['a word', 'one'],
  ['a number past the integers the database holds', '2147483648']
]

const listVersions = (user: TestUser, pageId: string) =>
  api.as(user).get(`/pages/${pageId}/versions`)

const getVersion = (user: TestUser, pageId: string, number: number | string) =>
  api.as(user).get(`/pages/${pageId}/versions/${String(number)}`)

/**
 * Onboarding in alice's new wiki, at its version 2: bob, an editor of the
 * wiki, published the `second` title and blocks over alice's `first`.
 */
async function anOnboardingPage() {
  const alice = aUser({ name: 'Alice Martin' })
  const bob = aUser({ organizationId: alice.organizationId, name: 'Bob' })
  const wiki = await aWikiOf(api, alice)
  await joinWiki(db, alice, wiki.id, bob, 'editor')
  const first = {
    title: 'Onboarding',
    content: [paragraph('Ask for a laptop')]
  }
  const second = { title: 'Welcome', content: [paragraph('Bring your badge')] }
  const pageId = await aPage(api, alice, wiki.id, first)
  const published = await publish(api, bob, pageId, {
    baseVersion: 1,
    ...second
  })
  return { alice, bob, wiki, page: published.json<Page>(), first, second }
}

describe('GET /pages/:pageId/versions', () => {
  it('lists the versions of the page, newest first, by whom and when', async () => {
    const { alice, bob, page } = await anOnboardingPage()

    const response = await listVersions(alice, page.id)

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({
      versions: [
        {
          number: 2,
          title: 'Welcome',
          author: personOf(bob),
          createdAt: page.updatedAt,
          restoredFrom: null
        },
        {
          number: 1,
          title: 'Onboarding',
          author: personOf(alice),
          createdAt: page.createdAt,
          restoredFrom: null
        }
      ]
    })
  })

  it('lists the versions of a page in the trash, which stays readable', async () => {
    const alice = aUser()
    const wiki = await aWikiOf(api, alice)
    const pageId = await aPageIn(db, alice, wiki.id, {
      title: 'Drafts',
      position: 'a0',
      deleted: true
    })

    const response = await listVersions(alice, pageId)

    expect(response.statusCode).toBe(200)
    expect(
      response
        .json<{ versions: VersionSummary[] }>()
        .versions.map(({ title }) => title)
    ).toEqual(['Drafts'])
  })

  it('shows the history to viewers and hides it from outsiders', async () => {
    const { alice, wiki, page } = await anOnboardingPage()
    const viewer = aUser({ organizationId: alice.organizationId })
    await joinWiki(db, alice, wiki.id, viewer, 'viewer')
    const outsider = aUser({ organizationId: alice.organizationId })

    const shown = await listVersions(viewer, page.id)
    const hidden = await listVersions(outsider, page.id)

    expect([shown.statusCode, hidden.statusCode]).toEqual([200, 404])
    expect(hidden.json()).toEqual({ error: 'not_found' })
  })

  it.each(waysOutOfAWiki)(
    'answers not_found for a page of %s',
    async (_case, someone, takeOut) => {
      const alice = someone()
      const carol = aUser({ organizationId: alice.organizationId })
      const wiki = await aWikiOf(api, carol)
      await joinWiki(db, carol, wiki.id, alice, 'viewer')
      const pageId = await aPage(api, carol, wiki.id, { title: 'Onboarding' })
      expect((await listVersions(alice, pageId)).statusCode).toBe(200)

      await takeOut(api, db, carol, wiki.id, alice)

      const response = await listVersions(alice, pageId)
      expect(response.statusCode).toBe(404)
      expect(response.json()).toEqual({ error: 'not_found' })
    }
  )

  it.each(malformedOrUnknownIds)(
    'answers not_found for a page with %s',
    async (_case, pageId) => {
      const response = await listVersions(aUser(), pageId)

      expect(response.statusCode).toBe(404)
      expect(response.json()).toEqual({ error: 'not_found' })
    }
  )
})

describe('GET /pages/:pageId/versions/:number', () => {
  it('shows a version with its title and blocks, as it was published', async () => {
    const { alice, page, first } = await anOnboardingPage()

    const response = await getVersion(alice, page.id, 1)

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({
      number: 1,
      title: 'Onboarding',
      author: personOf(alice),
      createdAt: page.createdAt,
      restoredFrom: null,
      content: first.content,
      gristUrl: null
    })
  })

  it('shows a database page’s version with its Grist address, and no blocks', async () => {
    const alice = aUser()
    const wiki = await aWikiOf(api, alice)
    const gristUrl = `${GRIST_ORIGIN}/o/docs/4kq2/Budget`
    // Written straight into the wiki, as no route makes a database page yet.
    const pageId = await aPageIn(db, alice, wiki.id, {
      title: 'Budget',
      position: 'a0',
      gristUrl
    })

    const response = await getVersion(alice, pageId, 1)

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({
      number: 1,
      title: 'Budget',
      author: personOf(alice),
      createdAt: expect.any(String) as string,
      restoredFrom: null,
      content: [],
      gristUrl
    })
  })

  it('shows a version of a page in the trash, which stays readable', async () => {
    const alice = aUser()
    const wiki = await aWikiOf(api, alice)
    const pageId = await aPageIn(db, alice, wiki.id, {
      title: 'Drafts',
      position: 'a0',
      deleted: true
    })

    const response = await getVersion(alice, pageId, 1)

    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({ number: 1, title: 'Drafts' })
  })

  it('shows a version to viewers and hides it from outsiders', async () => {
    const { alice, wiki, page } = await anOnboardingPage()
    const viewer = aUser({ organizationId: alice.organizationId })
    await joinWiki(db, alice, wiki.id, viewer, 'viewer')
    const outsider = aUser({ organizationId: alice.organizationId })

    const shown = await getVersion(viewer, page.id, 1)
    const hidden = await getVersion(outsider, page.id, 1)

    expect([shown.statusCode, hidden.statusCode]).toEqual([200, 404])
    expect(hidden.json()).toEqual({ error: 'not_found' })
  })

  it.each(waysOutOfAWiki)(
    'answers not_found for a version of a page of %s',
    async (_case, someone, takeOut) => {
      const alice = someone()
      const carol = aUser({ organizationId: alice.organizationId })
      const wiki = await aWikiOf(api, carol)
      await joinWiki(db, carol, wiki.id, alice, 'viewer')
      const pageId = await aPage(api, carol, wiki.id, { title: 'Onboarding' })
      expect((await getVersion(alice, pageId, 1)).statusCode).toBe(200)

      await takeOut(api, db, carol, wiki.id, alice)

      const response = await getVersion(alice, pageId, 1)
      expect(response.statusCode).toBe(404)
      expect(response.json()).toEqual({ error: 'not_found' })
    }
  )

  it.each(numbersOfNoVersion)(
    'answers not_found for %s',
    async (_case, number) => {
      const { alice, page } = await anOnboardingPage()

      const response = await getVersion(alice, page.id, number)

      expect(response.statusCode).toBe(404)
      expect(response.json()).toEqual({ error: 'not_found' })
    }
  )

  it.each(malformedOrUnknownIds)(
    'answers not_found for a page with %s',
    async (_case, pageId) => {
      const response = await getVersion(aUser(), pageId, 1)

      expect(response.statusCode).toBe(404)
      expect(response.json()).toEqual({ error: 'not_found' })
    }
  )
})

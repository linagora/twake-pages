import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest'
import { createDb } from '../../infra/db.ts'
import {
  aPage,
  aPageIn,
  aUser,
  aWikiOf,
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

const listVersions = (user: TestUser, pageId: string) =>
  api.as(user).get(`/pages/${pageId}/versions`)

/**
 * Onboarding in alice's new wiki, at its version 2: bob, an editor of the
 * wiki, published it over alice's version 1.
 */
async function anOnboardingPage() {
  const alice = aUser({ name: 'Alice Martin' })
  const bob = aUser({ organizationId: alice.organizationId, name: 'Bob' })
  const wiki = await aWikiOf(api, alice)
  await joinWiki(db, alice, wiki.id, bob, 'editor')
  const pageId = await aPage(api, alice, wiki.id, {
    title: 'Onboarding',
    content: [paragraph('Ask for a laptop')]
  })
  const published = await publish(api, bob, pageId, {
    baseVersion: 1,
    title: 'Welcome',
    content: [paragraph('Bring your badge')]
  })
  return { alice, bob, wiki, page: published.json<Page>() }
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

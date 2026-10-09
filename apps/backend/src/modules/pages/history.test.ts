import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest'
import { createDb } from '../../infra/db.ts'
import {
  aBlock,
  aGristVersionOf,
  aPage,
  aPageIn,
  aUser,
  aWikiOf,
  GRIST_ORIGIN,
  joinWiki,
  malformedOrUnknownIds,
  pageOf,
  paragraph,
  personOf,
  publish,
  restoreVersion,
  startApp,
  textsOf,
  versionOf,
  waysOutOfAWiki,
  wikiRowsOf,
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

/** A Grist origin the deployment named once, and names no longer. */
const FORMER_GRIST_ORIGIN = 'https://grist.example.net'

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

      await takeOut(api, carol, wiki.id, alice)

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
    const pageId = await aPage(api, alice, wiki.id, {
      title: 'Budget',
      kind: 'database',
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

      await takeOut(api, carol, wiki.id, alice)

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

describe('POST /pages/:pageId/versions/:number/restore', () => {
  it('publishes the version’s title and blocks again, as the newest version', async () => {
    const { alice, bob, wiki, page, first } = await anOnboardingPage()

    const response = await restoreVersion(api, bob, page.id, 1)

    expect(response.statusCode).toBe(201)
    expect(response.json()).toEqual({
      id: page.id,
      wikiId: wiki.id,
      parentId: null,
      home: false,
      kind: 'document',
      title: 'Onboarding',
      content: first.content,
      gristUrl: null,
      version: 3,
      createdAt: page.createdAt,
      createdBy: personOf(alice),
      updatedAt: expect.any(String) as string,
      updatedBy: personOf(bob),
      labels: [],
      ancestors: [],
      following: true,
      favorite: false,
      deletedAt: null,
      trashRootId: null
    })
  })

  it('lists the new version as restored from the version', async () => {
    const { alice, bob, page } = await anOnboardingPage()

    const restored = await restoreVersion(api, bob, page.id, 1)

    const history = await listVersions(alice, page.id)
    expect(history.json<{ versions: VersionSummary[] }>().versions[0]).toEqual({
      number: 3,
      title: 'Onboarding',
      author: personOf(bob),
      createdAt: restored.json<Page>().updatedAt,
      restoredFrom: 1
    })
  })

  it('publishes the current version again, as the next one restored from it', async () => {
    const { alice, page, second } = await anOnboardingPage()

    const response = await restoreVersion(api, alice, page.id, 2)

    expect(response.statusCode).toBe(201)
    expect(response.json()).toMatchObject({ ...second, version: 3 })
    const history = await listVersions(alice, page.id)
    expect(
      history.json<{ versions: VersionSummary[] }>().versions[0]
    ).toMatchObject({ number: 3, restoredFrom: 2 })
  })

  it('gives the page the plain text of the version again', async () => {
    const { alice, bob, page } = await anOnboardingPage()

    await restoreVersion(api, bob, page.id, 1)

    expect(await textsOf(db, alice, page.id)).toEqual({
      page: 'Ask for a laptop',
      versions: ['Ask for a laptop', 'Bring your badge', 'Ask for a laptop']
    })
  })

  it('makes the person who restores it follow the page', async () => {
    const { alice, wiki, page } = await anOnboardingPage()
    const carol = aUser({ organizationId: alice.organizationId })
    await joinWiki(db, alice, wiki.id, carol, 'editor')
    const before = (await pageOf(api, carol, page.id)).following

    await restoreVersion(api, carol, page.id, 1)

    expect([before, (await pageOf(api, carol, page.id)).following]).toEqual([
      false,
      true
    ])
  })

  it('moves the wiki’s version, so everyone sees the restored version live', async () => {
    const { alice, bob, wiki, page } = await anOnboardingPage()
    const before = await versionOf(api, alice, wiki.id)

    await restoreVersion(api, bob, page.id, 1)

    expect(await versionOf(api, alice, wiki.id)).toBeGreaterThan(before)
  })

  it('restores a database page’s version with its Grist address, and no blocks', async () => {
    const alice = aUser()
    const wiki = await aWikiOf(api, alice)
    const first = `${GRIST_ORIGIN}/o/docs/4kq2/Budget`
    const pageId = await aPage(api, alice, wiki.id, {
      title: 'Budget',
      kind: 'database',
      gristUrl: first
    })
    // Written straight into the wiki, as no route publishes a database page
    // yet.
    await aGristVersionOf(
      db,
      alice,
      pageId,
      `${GRIST_ORIGIN}/o/docs/9mz3/Budget`
    )

    const response = await restoreVersion(api, alice, pageId, 1)

    expect(response.statusCode).toBe(201)
    expect(response.json()).toMatchObject({
      kind: 'database',
      content: [],
      gristUrl: first,
      version: 3
    })
  })

  it('answers invalid_content for blocks publishing refuses now, and leaves the wiki as it was', async () => {
    const alice = aUser()
    const wiki = await aWikiOf(api, alice)
    // Written straight into the wiki, as published while the deployment's
    // Grist origins still named this one.
    const pageId = await aPageIn(db, alice, wiki.id, {
      title: 'Budget',
      position: 'a0',
      content: [
        aBlock('gristEmbed', {
          props: { url: `${FORMER_GRIST_ORIGIN}/o/docs/4kq2/Budget` }
        })
      ]
    })
    await publish(api, alice, pageId, {
      baseVersion: 1,
      title: 'Budget',
      content: []
    })
    const before = await versionOf(api, alice, wiki.id)

    const response = await restoreVersion(api, alice, pageId, 1)

    expect(response.statusCode).toBe(400)
    expect(response.json()).toEqual({ error: 'invalid_content' })
    expect(await versionOf(api, alice, wiki.id)).toBe(before)
  })

  it('answers invalid_grist_url for an address off the deployment’s Grist origins, and leaves the wiki as it was', async () => {
    const alice = aUser()
    const wiki = await aWikiOf(api, alice)
    // Written straight into the wiki, as created while the deployment's Grist
    // origins named this one, then published again as no route publishes a
    // database page yet.
    const pageId = await aPageIn(db, alice, wiki.id, {
      title: 'Budget',
      position: 'a0',
      gristUrl: `${FORMER_GRIST_ORIGIN}/o/docs/4kq2/Budget`
    })
    await aGristVersionOf(
      db,
      alice,
      pageId,
      `${GRIST_ORIGIN}/o/docs/4kq2/Budget`
    )
    const before = await versionOf(api, alice, wiki.id)

    const response = await restoreVersion(api, alice, pageId, 1)

    expect(response.statusCode).toBe(400)
    expect(response.json()).toEqual({ error: 'invalid_grist_url' })
    expect(await versionOf(api, alice, wiki.id)).toBe(before)
  })

  it('answers invalid_grist_url for a version at a blob: address of a Grist origin, and leaves the wiki as it was', async () => {
    const alice = aUser()
    const wiki = await aWikiOf(api, alice)
    // Written straight into the wiki, as kept before such an address was
    // refused.
    const pageId = await aPageIn(db, alice, wiki.id, {
      title: 'Budget',
      position: 'a0',
      gristUrl: `blob:${GRIST_ORIGIN}/4kq2`
    })
    const before = await versionOf(api, alice, wiki.id)

    const response = await restoreVersion(api, alice, pageId, 1)

    expect(response.statusCode).toBe(400)
    expect(response.json()).toEqual({ error: 'invalid_grist_url' })
    expect(await versionOf(api, alice, wiki.id)).toBe(before)
  })

  it('answers in_trash for a page in the trash, and leaves the wiki as it was', async () => {
    const alice = aUser()
    const wiki = await aWikiOf(api, alice)
    const pageId = await aPageIn(db, alice, wiki.id, {
      title: 'Drafts',
      position: 'a0',
      deleted: true
    })
    const before = await versionOf(api, alice, wiki.id)

    const response = await restoreVersion(api, alice, pageId, 1)

    expect(response.statusCode).toBe(409)
    expect(response.json()).toEqual({ error: 'in_trash' })
    expect(await versionOf(api, alice, wiki.id)).toBe(before)
  })

  it('answers forbidden to a viewer, and leaves the wiki as it was', async () => {
    const { alice, wiki, page } = await anOnboardingPage()
    const viewer = aUser({ organizationId: alice.organizationId })
    await joinWiki(db, alice, wiki.id, viewer, 'viewer')
    const before = await versionOf(api, alice, wiki.id)

    const response = await restoreVersion(api, viewer, page.id, 1)

    expect(response.statusCode).toBe(403)
    expect(response.json()).toEqual({ error: 'forbidden' })
    expect(await versionOf(api, alice, wiki.id)).toBe(before)
  })

  it.each(waysOutOfAWiki)(
    'answers not_found for a page of %s, and leaves the wiki as it was',
    async (_case, someone, takeOut) => {
      const alice = someone()
      const carol = aUser({ organizationId: alice.organizationId })
      const wiki = await aWikiOf(api, carol)
      await joinWiki(db, carol, wiki.id, alice, 'editor')
      const pageId = await aPage(api, carol, wiki.id, { title: 'Onboarding' })
      expect((await restoreVersion(api, alice, pageId, 1)).statusCode).toBe(201)
      await takeOut(api, carol, wiki.id, alice)
      const before = await wikiRowsOf(db, carol, wiki.id)

      const response = await restoreVersion(api, alice, pageId, 1)

      expect(response.statusCode).toBe(404)
      expect(response.json()).toEqual({ error: 'not_found' })
      expect(await wikiRowsOf(db, carol, wiki.id)).toEqual(before)
    }
  )

  it.each(numbersOfNoVersion)(
    'answers not_found for %s, and leaves the wiki as it was',
    async (_case, number) => {
      const { alice, wiki, page } = await anOnboardingPage()
      const before = await versionOf(api, alice, wiki.id)

      const response = await restoreVersion(api, alice, page.id, number)

      expect(response.statusCode).toBe(404)
      expect(response.json()).toEqual({ error: 'not_found' })
      expect(await versionOf(api, alice, wiki.id)).toBe(before)
    }
  )

  it.each(malformedOrUnknownIds)(
    'answers not_found for a page with %s',
    async (_case, pageId) => {
      const response = await restoreVersion(api, aUser(), pageId, 1)

      expect(response.statusCode).toBe(404)
      expect(response.json()).toEqual({ error: 'not_found' })
    }
  )
})

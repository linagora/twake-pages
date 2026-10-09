import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest'
import { createDb } from '../../infra/db.ts'
import {
  aB2cUser,
  aBlock,
  aPage,
  aPageIn,
  aUser,
  aWikiOf,
  createPage,
  GRIST_ORIGIN,
  joinWiki,
  MALFORMED_GRIST_URLS,
  malformedOrUnknownIds,
  OFF_GRIST_ORIGINS,
  pageOf,
  paragraph,
  personOf,
  publish,
  startApp,
  styled,
  textsOf,
  versionOf,
  type Page,
  type TestUser
} from '../../testing/app.ts'
import { MAX_BLOCKS_BYTES } from './blocks.ts'

let api: Awaited<ReturnType<typeof startApp>>
const { sql, db } = createDb(inject('databaseUrl'))

beforeAll(async () => {
  api = await startApp()
})

afterAll(async () => {
  await api.close()
  await sql.end()
})

/** A page of the person's new wiki, at its version 1. */
async function aPageOf(user: TestUser) {
  const wiki = await aWikiOf(api, user)
  const created = await createPage(api, user, wiki.id, { title: 'Onboarding' })
  return { wiki, page: created.json<{ id: string; createdAt: string }>() }
}

describe('POST /pages/:pageId/versions', () => {
  it.each([
    ['in an organization', () => aUser({ name: 'Alice Martin' })],
    ['in B2C', () => ({ ...aB2cUser(), name: 'Alice Martin' })]
  ])(
    'publishes the title and the blocks as the next version, by its author, %s',
    async (_case, someone) => {
      const alice = someone()
      const { wiki, page } = await aPageOf(alice)
      const blocks = [paragraph('Ask for a laptop')]

      const response = await publish(api, alice, page.id, {
        baseVersion: 1,
        title: ' Welcome ',
        content: blocks
      })

      const author = personOf(alice)
      expect(response.statusCode).toBe(201)
      expect(response.json()).toEqual({
        id: page.id,
        wikiId: wiki.id,
        parentId: null,
        home: false,
        kind: 'document',
        title: 'Welcome',
        content: blocks,
        gristUrl: null,
        version: 2,
        createdAt: page.createdAt,
        createdBy: author,
        updatedAt: expect.any(String) as string,
        updatedBy: author,
        labels: [],
        ancestors: [],
        following: true,
        favorite: false,
        deletedAt: null,
        trashRootId: null
      })
    }
  )

  it('numbers the next version after the current one', async () => {
    const alice = aUser()
    const { page } = await aPageOf(alice)
    await publish(api, alice, page.id, {
      baseVersion: 1,
      title: 'Onboarding',
      content: []
    })

    const response = await publish(api, alice, page.id, {
      baseVersion: 2,
      title: 'Onboarding',
      content: []
    })

    expect(response.json<Page>().version).toBe(3)
  })

  it('makes its author follow the page', async () => {
    const alice = aUser()
    const bob = aUser({ organizationId: alice.organizationId })
    const { wiki, page } = await aPageOf(alice)
    await joinWiki(db, alice, wiki.id, bob, 'editor')

    await publish(api, bob, page.id, {
      baseVersion: 1,
      title: 'Onboarding',
      content: []
    })

    expect((await pageOf(api, bob, page.id)).following).toBe(true)
  })

  it('keeps the plain text of its blocks', async () => {
    const alice = aUser()
    const { page } = await aPageOf(alice)

    await publish(api, alice, page.id, {
      baseVersion: 1,
      title: 'Onboarding',
      content: [paragraph('Ask for a laptop'), paragraph('Then a badge')]
    })

    const text = 'Ask for a laptop\nThen a badge'
    expect(await textsOf(db, alice, page.id)).toEqual({
      page: text,
      versions: ['', text]
    })
  })

  it('moves the wiki’s version, so everyone sees the new version live', async () => {
    const alice = aUser()
    const { wiki, page } = await aPageOf(alice)
    const before = await versionOf(api, alice, wiki.id)

    await publish(api, alice, page.id, {
      baseVersion: 1,
      title: 'Onboarding',
      content: []
    })

    expect(await versionOf(api, alice, wiki.id)).toBeGreaterThan(before)
  })

  it('answers edit_conflict with the current version, for a draft started from an older one', async () => {
    const alice = aUser()
    const bob = aUser({ organizationId: alice.organizationId, name: 'Bob' })
    const { wiki, page } = await aPageOf(alice)
    await joinWiki(db, alice, wiki.id, bob, 'editor')
    const bobs = await publish(api, bob, page.id, {
      baseVersion: 1,
      title: 'Welcome',
      content: []
    })
    const before = await versionOf(api, alice, wiki.id)

    const response = await publish(api, alice, page.id, {
      baseVersion: 1,
      title: 'Onboarding',
      content: [paragraph('Ask for a laptop')]
    })

    expect(response.statusCode).toBe(409)
    expect(response.json()).toEqual({
      error: 'edit_conflict',
      current: {
        number: 2,
        title: 'Welcome',
        author: personOf(bob),
        createdAt: bobs.json<Page>().updatedAt,
        restoredFrom: null
      }
    })
    expect(await versionOf(api, alice, wiki.id)).toBe(before)
  })

  it('answers in_trash for a page in the trash', async () => {
    const alice = aUser()
    const wiki = await aWikiOf(api, alice)
    const pageId = await aPageIn(db, alice, wiki.id, {
      title: 'Drafts',
      position: 'a0',
      deleted: true
    })
    const before = await versionOf(api, alice, wiki.id)

    const response = await publish(api, alice, pageId, {
      baseVersion: 1,
      title: 'Drafts',
      content: []
    })

    expect(response.statusCode).toBe(409)
    expect(response.json()).toEqual({ error: 'in_trash' })
    expect(await versionOf(api, alice, wiki.id)).toBe(before)
  })

  it('answers invalid_request for blocks sent to a database page', async () => {
    const alice = aUser()
    const wiki = await aWikiOf(api, alice)
    const pageId = await aPage(api, alice, wiki.id, {
      title: 'Budget',
      kind: 'database',
      gristUrl: `${GRIST_ORIGIN}/o/docs/4kq2/Budget`
    })
    const before = await versionOf(api, alice, wiki.id)

    const response = await publish(api, alice, pageId, {
      baseVersion: 1,
      title: 'Budget',
      content: [paragraph('Spent in March')]
    })

    expect(response.statusCode).toBe(400)
    expect(response.json()).toEqual({ error: 'invalid_request' })
    expect(await versionOf(api, alice, wiki.id)).toBe(before)
  })

  it('answers forbidden to a viewer of the wiki', async () => {
    const alice = aUser()
    const bob = aUser({ organizationId: alice.organizationId })
    const { wiki, page } = await aPageOf(alice)
    await joinWiki(db, alice, wiki.id, bob, 'viewer')
    const before = await versionOf(api, alice, wiki.id)

    const response = await publish(api, bob, page.id, {
      baseVersion: 1,
      title: 'Onboarding',
      content: []
    })

    expect(response.statusCode).toBe(403)
    expect(response.json()).toEqual({ error: 'forbidden' })
    expect(await versionOf(api, alice, wiki.id)).toBe(before)
  })

  it('answers not_found to someone who is no member', async () => {
    const alice = aUser()
    const outsider = aUser({ organizationId: alice.organizationId })
    const { wiki, page } = await aPageOf(alice)
    const before = await versionOf(api, alice, wiki.id)

    const response = await publish(api, outsider, page.id, {
      baseVersion: 1,
      title: 'Onboarding',
      content: []
    })

    expect(response.statusCode).toBe(404)
    expect(response.json()).toEqual({ error: 'not_found' })
    expect(await versionOf(api, alice, wiki.id)).toBe(before)
  })

  it.each(malformedOrUnknownIds)(
    'answers not_found for a page with %s',
    async (_case, pageId) => {
      const response = await publish(api, aUser(), pageId, {
        baseVersion: 1,
        title: 'Onboarding',
        content: []
      })

      expect(response.statusCode).toBe(404)
      expect(response.json()).toEqual({ error: 'not_found' })
    }
  )

  it.each([
    [
      'blocks it refuses',
      [
        aBlock('paragraph', {
          content: [
            {
              type: 'link',
              href: 'javascript:alert(1)',
              content: [styled('the guide')]
            }
          ]
        })
      ]
    ],
    [
      'blocks in a body over the size of any request',
      [paragraph('a'.repeat(2 * MAX_BLOCKS_BYTES))]
    ]
  ])('answers invalid_content for %s', async (_case, content) => {
    const alice = aUser()
    const { wiki, page } = await aPageOf(alice)
    const before = await versionOf(api, alice, wiki.id)

    const response = await publish(api, alice, page.id, {
      baseVersion: 1,
      title: 'Onboarding',
      content
    })

    expect(response.statusCode).toBe(400)
    expect(response.json()).toEqual({ error: 'invalid_content' })
    expect(await versionOf(api, alice, wiki.id)).toBe(before)
  })

  it.each([
    ['no base version', { title: 'Onboarding', content: [] }],
    [
      'a base version of 0',
      { baseVersion: 0, title: 'Onboarding', content: [] }
    ],
    ['a blank title', { baseVersion: 1, title: ' ', content: [] }],
    [
      'a NUL character in the title',
      { baseVersion: 1, title: 'On\u0000boarding', content: [] }
    ],
    [
      'neither blocks nor a Grist address',
      { baseVersion: 1, title: 'Onboarding' }
    ],
    [
      'both blocks and a Grist address',
      {
        baseVersion: 1,
        title: 'Onboarding',
        content: [],
        gristUrl: `${GRIST_ORIGIN}/o/docs/4kq2/Budget`
      }
    ]
  ])('answers invalid_request for %s', async (_case, draft) => {
    const alice = aUser()
    const { wiki, page } = await aPageOf(alice)
    const before = await versionOf(api, alice, wiki.id)

    const response = await api
      .as(alice)
      .post(`/pages/${page.id}/versions`, draft)

    expect(response.statusCode).toBe(400)
    expect(response.json()).toEqual({ error: 'invalid_request' })
    expect(await versionOf(api, alice, wiki.id)).toBe(before)
  })

  describe('a database page', () => {
    const gristUrl = `${GRIST_ORIGIN}/o/docs/4kq2/Budget`
    const nextUrl = `${GRIST_ORIGIN}/o/docs/9mz3/Budget`

    /** Budget, a database page of the person's new wiki, at its version 1. */
    async function aBudgetOf(user: TestUser) {
      const wiki = await aWikiOf(api, user)
      const pageId = await aPage(api, user, wiki.id, {
        title: 'Budget',
        kind: 'database',
        gristUrl
      })
      return { wiki, pageId }
    }

    it('publishes the title and the Grist address as the next version, with no blocks', async () => {
      const alice = aUser()
      const { pageId } = await aBudgetOf(alice)

      const response = await publish(api, alice, pageId, {
        baseVersion: 1,
        title: ' Budget 2027 ',
        gristUrl: nextUrl
      })

      expect(response.statusCode).toBe(201)
      expect(response.json()).toMatchObject({
        id: pageId,
        kind: 'database',
        title: 'Budget 2027',
        content: [],
        gristUrl: nextUrl,
        version: 2
      })
    })

    it('writes its Grist address in the version', async () => {
      const alice = aUser()
      const { pageId } = await aBudgetOf(alice)
      await publish(api, alice, pageId, {
        baseVersion: 1,
        title: 'Budget',
        gristUrl: nextUrl
      })

      const version = await api.as(alice).get(`/pages/${pageId}/versions/2`)

      expect(version.json()).toMatchObject({
        number: 2,
        content: [],
        gristUrl: nextUrl
      })
    })

    it.each(OFF_GRIST_ORIGINS)(
      'answers invalid_grist_url for a version %s, and leaves the wiki as it was',
      async (_case, url) => {
        const alice = aUser()
        const { wiki, pageId } = await aBudgetOf(alice)
        const before = await versionOf(api, alice, wiki.id)

        const response = await publish(api, alice, pageId, {
          baseVersion: 1,
          title: 'Budget',
          gristUrl: url
        })

        expect(response.statusCode).toBe(400)
        expect(response.json()).toEqual({ error: 'invalid_grist_url' })
        expect(await versionOf(api, alice, wiki.id)).toBe(before)
      }
    )

    // Two checks apply to each: the address, which needs nothing but the
    // body, comes first (api.md).
    it.each([
      [
        'forbidden, to a viewer',
        async (alice: TestUser) => {
          const { wiki, pageId } = await aBudgetOf(alice)
          const bob = aUser({ organizationId: alice.organizationId })
          await joinWiki(db, alice, wiki.id, bob, 'viewer')
          return { who: bob, wikiId: wiki.id, pageId }
        }
      ],
      [
        'in_trash, for a page in the trash',
        async (alice: TestUser) => {
          const wiki = await aWikiOf(api, alice)
          const pageId = await aPageIn(db, alice, wiki.id, {
            title: 'Budget',
            position: 'a0',
            gristUrl,
            deleted: true
          })
          return { who: alice, wikiId: wiki.id, pageId }
        }
      ],
      [
        'edit_conflict, for a draft started from an older version',
        async (alice: TestUser) => {
          const { wiki, pageId } = await aBudgetOf(alice)
          await publish(api, alice, pageId, {
            baseVersion: 1,
            title: 'Budget',
            gristUrl: nextUrl
          })
          return { who: alice, wikiId: wiki.id, pageId }
        }
      ]
    ])(
      'answers invalid_grist_url, not %s, with an address off the Grist origins',
      async (_case, aPageToPublish) => {
        const alice = aUser()
        const { who, wikiId, pageId } = await aPageToPublish(alice)
        const before = await versionOf(api, alice, wikiId)

        const response = await publish(api, who, pageId, {
          baseVersion: 1,
          title: 'Budget',
          gristUrl: 'https://docs.example.com/o/docs/4kq2'
        })

        expect(response.statusCode).toBe(400)
        expect(response.json()).toEqual({ error: 'invalid_grist_url' })
        expect(await versionOf(api, alice, wikiId)).toBe(before)
      }
    )

    it('answers invalid_request for a Grist address sent to a document', async () => {
      const alice = aUser()
      const { wiki, page } = await aPageOf(alice)
      const before = await versionOf(api, alice, wiki.id)

      const response = await publish(api, alice, page.id, {
        baseVersion: 1,
        title: 'Onboarding',
        gristUrl
      })

      expect(response.statusCode).toBe(400)
      expect(response.json()).toEqual({ error: 'invalid_request' })
      expect(await versionOf(api, alice, wiki.id)).toBe(before)
    })

    // The page tells its kind behind the wiki's row lock: after the trash,
    // before the version the draft started from (api.md).
    it('answers in_trash, not invalid_request, for blocks sent to a database page in the trash', async () => {
      const alice = aUser()
      const wiki = await aWikiOf(api, alice)
      const pageId = await aPageIn(db, alice, wiki.id, {
        title: 'Budget',
        position: 'a0',
        gristUrl,
        deleted: true
      })
      const before = await versionOf(api, alice, wiki.id)

      const response = await publish(api, alice, pageId, {
        baseVersion: 1,
        title: 'Budget',
        content: [paragraph('Spent in March')]
      })

      expect(response.statusCode).toBe(409)
      expect(response.json()).toEqual({ error: 'in_trash' })
      expect(await versionOf(api, alice, wiki.id)).toBe(before)
    })

    it('answers invalid_request, not edit_conflict, for a Grist address sent to a document from an older version', async () => {
      const alice = aUser()
      const { wiki, page } = await aPageOf(alice)
      await publish(api, alice, page.id, {
        baseVersion: 1,
        title: 'Onboarding',
        content: [paragraph('Ask for a laptop')]
      })
      const before = await versionOf(api, alice, wiki.id)

      const response = await publish(api, alice, page.id, {
        baseVersion: 1,
        title: 'Onboarding',
        gristUrl
      })

      expect(response.statusCode).toBe(400)
      expect(response.json()).toEqual({ error: 'invalid_request' })
      expect(await versionOf(api, alice, wiki.id)).toBe(before)
    })

    it.each(MALFORMED_GRIST_URLS)(
      'answers invalid_request for a Grist address %s, and leaves the wiki as it was',
      async (_case, url) => {
        const alice = aUser()
        const { wiki, pageId } = await aBudgetOf(alice)
        const before = await versionOf(api, alice, wiki.id)

        const response = await api.as(alice).post(`/pages/${pageId}/versions`, {
          baseVersion: 1,
          title: 'Budget',
          gristUrl: url
        })

        expect(response.statusCode).toBe(400)
        expect(response.json()).toEqual({ error: 'invalid_request' })
        expect(await versionOf(api, alice, wiki.id)).toBe(before)
      }
    )
  })
})

import { sql as raw } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest'
import { outbox } from '../../events/schema.ts'
import { createDb } from '../../infra/db.ts'
import {
  aB2cUser,
  aBlock,
  aSpaceWiki,
  aUser,
  aWikiOf,
  createPage,
  personalWikiOf,
  startApp,
  styled,
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

const UUID_V7 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

// To the microsecond, in UTC, as Twake Tasks writes it.
const TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/

/** The events about the page waiting in the outbox for RabbitMQ, oldest first. */
async function eventsOf(pageId: string) {
  const rows = await db
    .select({ event: outbox.event })
    .from(outbox)
    .where(raw`${outbox.event} -> 'data' -> 'object' ->> 'id' = ${pageId}`)
    .orderBy(outbox.id)
  return rows.map(row => row.event as Record<string, unknown>)
}

const paragraph = (text: string) =>
  aBlock('paragraph', { content: [styled(text)] })

describe('com.twake.pages.page.created.v1', () => {
  it('goes out through the outbox when an editor creates a page', async () => {
    const alice = aUser()
    const wiki = await aWikiOf(api, alice)

    const created = await createPage(api, alice, wiki.id, {
      title: 'Onboarding',
      content: [paragraph('Steps'), paragraph('Ask for a laptop')]
    })

    const pageId = created.json<{ id: string }>().id
    expect(await eventsOf(pageId)).toEqual([
      {
        specversion: '1.0',
        id: expect.stringMatching(UUID_V7) as string,
        source: 'twake://pages',
        type: 'com.twake.pages.page.created.v1',
        time: expect.stringMatching(TIME) as string,
        twakeorg: alice.organizationId,
        twakeactorid: alice.userId,
        twakeactor: alice.email,
        data: {
          object: {
            type: 'page',
            id: pageId,
            title: 'Onboarding',
            container: { kind: 'wiki', id: wiki.id }
          },
          preview: 'Steps\nAsk for a laptop'
        }
      }
    ])
  })

  it('leaves twakeorg out in B2C', async () => {
    const alice = aB2cUser()
    const wiki = await aWikiOf(api, alice)

    const created = await createPage(api, alice, wiki.id, {
      title: 'Onboarding'
    })

    const [event] = await eventsOf(created.json<{ id: string }>().id)
    expect(event).not.toHaveProperty('twakeorg')
    expect(event).toHaveProperty('twakeactorid', alice.userId)
  })

  it.each([
    [
      'a personal wiki',
      async (alice: TestUser) => (await personalWikiOf(api, alice)).id
    ],
    [
      'a shared wiki',
      async (alice: TestUser) => (await aWikiOf(api, alice)).id
    ],
    ['a space wiki', (alice: TestUser) => aSpaceWiki(db, [[alice, 'editor']])]
  ])('goes out for a page of %s', async (_case, wikiOf) => {
    const alice = aUser()
    const wikiId = await wikiOf(alice)

    const created = await createPage(api, alice, wikiId, {
      title: 'Onboarding'
    })

    expect(await eventsOf(created.json<{ id: string }>().id)).toEqual([
      expect.objectContaining({ type: 'com.twake.pages.page.created.v1' })
    ])
  })

  // Cut between characters, so an emoji at the end stays whole.
  it('previews the first 280 characters of the page’s text', async () => {
    const alice = aUser()
    const wiki = await aWikiOf(api, alice)
    const start = `${'a'.repeat(279)}😀`

    const created = await createPage(api, alice, wiki.id, {
      title: 'Onboarding',
      content: [paragraph(`${start}b`)]
    })

    const [event] = await eventsOf(created.json<{ id: string }>().id)
    expect(event?.data).toHaveProperty('preview', start)
  })

  it('goes out for no home page, which comes with its wiki', async () => {
    const alice = aUser()

    const wiki = await aWikiOf(api, alice)

    expect(await eventsOf(wiki.homePageId)).toEqual([])
  })
})

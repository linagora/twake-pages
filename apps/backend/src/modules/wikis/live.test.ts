import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest'
import { createDb } from '../../infra/db.ts'
import {
  aUser,
  aWikiOf,
  joinWiki,
  startApp,
  type TestUser
} from '../../testing/app.ts'
import { openStream } from '../../testing/stream.ts'

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

const openWikiStream = (user: TestUser, wikiId: string) =>
  openStream(`${baseUrl}/api/wikis/${wikiId}/stream`, api.tokenOf(user))

describe('live wiki updates', () => {
  it('sends the wiki version, then each new version as the wiki changes', async () => {
    const alice = aUser()
    const wiki = await aWikiOf(api, alice)
    const stream = openWikiStream(alice, wiki.id)

    const first = (await stream.messages.next()).value
    await api.as(alice).patch(`/wikis/${wiki.id}`, { name: 'Guide' })
    const second = (await stream.messages.next()).value
    stream.close()

    expect((await stream.response).headers.get('content-type')).toBe(
      'text/event-stream'
    )
    expect(first).toEqual({ event: 'version', id: '0', data: '{"version":0}' })
    expect(second).toEqual({
      event: 'version',
      id: '1',
      data: '{"version":1}'
    })
  })

  it('sends a new version when the admin deletes the wiki', async () => {
    const alice = aUser()
    const wiki = await aWikiOf(api, alice)
    const stream = openWikiStream(alice, wiki.id)

    await stream.messages.next()
    await api.as(alice).delete(`/wikis/${wiki.id}`)
    const next = (await stream.messages.next()).value
    stream.close()

    expect(next).toEqual({ event: 'version', id: '1', data: '{"version":1}' })
  })

  it.each(['viewer', 'editor'] as const)(
    'streams the version to the wiki’s %ss',
    async role => {
      const alice = aUser()
      const bob = aUser({ organizationId: alice.organizationId })
      const wiki = await aWikiOf(api, alice)
      await joinWiki(db, alice, wiki.id, bob, role)
      const stream = openWikiStream(bob, wiki.id)

      const first = (await stream.messages.next()).value
      stream.close()

      expect(first).toEqual({
        event: 'version',
        id: '0',
        data: '{"version":0}'
      })
    }
  )

  it('refuses a stream on a wiki the person cannot see', async () => {
    const wiki = await aWikiOf(api, aUser())
    const stream = openWikiStream(aUser(), wiki.id)

    expect((await stream.response).status).toBe(404)
    stream.close()
  })
})

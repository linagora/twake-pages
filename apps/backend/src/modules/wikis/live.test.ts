import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { aUser, startApp, type TestUser } from '../../testing/app.ts'
import { openStream } from '../../testing/stream.ts'

let api: Awaited<ReturnType<typeof startApp>>
let baseUrl: string

beforeAll(async () => {
  api = await startApp()
  baseUrl = await api.listen()
})

afterAll(async () => {
  await api.close()
})

const aWikiOf = async (owner: TestUser) =>
  (await api.as(owner).post('/wikis', { name: 'Handbook' })).json<{
    id: string
  }>()

const openWikiStream = (user: TestUser, wikiId: string) =>
  openStream(`${baseUrl}/api/wikis/${wikiId}/stream`, api.tokenOf(user))

describe('live wiki updates', () => {
  it('sends the wiki version, then each new version as the wiki changes', async () => {
    const alice = aUser()
    const wiki = await aWikiOf(alice)
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

  it('refuses a stream on a wiki the person cannot see', async () => {
    const wiki = await aWikiOf(aUser())
    const stream = openWikiStream(aUser(), wiki.id)

    expect((await stream.response).status).toBe(404)
    stream.close()
  })
})

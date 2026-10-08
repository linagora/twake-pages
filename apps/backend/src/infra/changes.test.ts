import Fastify from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { openStream } from '../testing/stream.ts'
import { versionStreams, type Changes } from './changes.ts'

// Changes announced when the test says, as the database's notifications
// arrive whenever the listening connection reads them.
function announcedChanges() {
  let listener: ((version: number) => void) | undefined
  const changes: Changes = {
    subscribe(_key, subscribed) {
      listener = subscribed
      return () => {
        listener = undefined
      }
    },
    close: () => Promise.resolve()
  }
  return { changes, announce: (version: number) => listener?.(version) }
}

const { changes, announce } = announcedChanges()
const app = Fastify()
let baseUrl: string

beforeAll(async () => {
  const streamVersions = versionStreams(app)
  app.get('/events', (request, reply) =>
    streamVersions(request, reply, {
      changes,
      key: 'alice',
      current: () => {
        // Committed before the stream opened, but announced while it reads.
        announce(2)
        return Promise.resolve(2)
      }
    })
  )
  baseUrl = await app.listen({ host: '127.0.0.1', port: 0 })
})

afterAll(() => app.close())

describe('version streams', () => {
  it('sends each version once, and none older than one it sent', async () => {
    const stream = openStream(`${baseUrl}/events`, 'token')

    const first = (await stream.messages.next()).value
    announce(1)
    announce(3)
    const second = (await stream.messages.next()).value
    stream.close()

    expect([first?.id, second?.id]).toEqual(['2', '3'])
  })
})

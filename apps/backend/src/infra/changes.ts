import type { FastifyReply, FastifyRequest } from 'fastify'
import type postgres from 'postgres'
import type { HttpServer } from './http.ts'

const HEARTBEAT_MS = 25_000

type Listener = (version: number) => void

export interface Changes {
  subscribe(key: string, listener: Listener): () => void
  close(): Promise<void>
}

// One connection per replica listens for every key, so a change made on any
// replica reaches the streams open on this one. Payloads are "<key> <version>".
export async function listenToChanges(
  client: postgres.Sql,
  channel: string
): Promise<Changes> {
  const listeners = new Map<string, Set<Listener>>()
  const subscription = await client.listen(channel, payload => {
    const space = payload.lastIndexOf(' ')
    const key = payload.slice(0, space)
    const version = Number(payload.slice(space + 1))
    for (const listener of listeners.get(key) ?? []) listener(version)
  })
  return {
    subscribe(key, listener) {
      const set = listeners.get(key) ?? new Set()
      listeners.set(key, set.add(listener))
      return () => {
        set.delete(listener)
        if (set.size === 0) listeners.delete(key)
      }
    },
    close: () => subscription.unlisten()
  }
}

export type StreamVersions = (
  request: FastifyRequest,
  reply: FastifyReply,
  stream: { changes: Changes; key: string; current: () => Promise<number> }
) => Promise<void>

/** Streams a version as server-sent events: the current one, then each new one. */
export function versionStreams(app: HttpServer): StreamVersions {
  // Open streams would hold the server open on shutdown; clients reconnect.
  const open = new Set<() => void>()
  app.addHook('preClose', done => {
    for (const end of open) end()
    done()
  })

  return async (request, reply, { changes, key, current }) => {
    reply.hijack()
    const stream = reply.raw
    stream.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-store',
      'x-accel-buffering': 'no'
    })
    const send = (version: number) => {
      stream.write(
        `id: ${String(version)}\ndata: ${JSON.stringify({ version })}\n\n`
      )
    }
    // Subscribed before reading, so a change committed in between still arrives.
    const unsubscribe = changes.subscribe(key, send)
    const heartbeat = setInterval(() => stream.write(':\n\n'), HEARTBEAT_MS)
    const end = () => stream.end()
    open.add(end)
    request.raw.on('close', () => {
      clearInterval(heartbeat)
      unsubscribe()
      open.delete(end)
    })
    try {
      send(await current())
    } catch (error) {
      request.log.error({ err: error }, 'stream version unreadable')
      end()
    }
  }
}

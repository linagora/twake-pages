import { z } from 'zod'
import type { Db } from '../../infra/db.ts'
import type { HttpServer } from '../../infra/http.ts'
import { refuse } from '../../infra/refusals.ts'
import type { RequireIdentity } from '../auth/index.ts'
import { createNotificationStore, MAX_READ_IDS } from './store.ts'

// Some notifications by id, all of them, or those about a wiki's pages: an
// exclusive union, as a new version is. Anything else is malformed.
const readSelection = z.union([
  z.object({
    ids: z.array(z.uuid()).min(1).max(MAX_READ_IDS),
    all: z.never().optional(),
    wikiId: z.never().optional()
  }),
  z.object({
    all: z.literal(true),
    ids: z.never().optional(),
    wikiId: z.never().optional()
  }),
  z.object({
    wikiId: z.uuid(),
    ids: z.never().optional(),
    all: z.never().optional()
  })
])

export function registerNotifications(
  app: HttpServer,
  deps: { db: Db; requireIdentity: RequireIdentity }
): void {
  const store = createNotificationStore(deps.db)

  app.get(
    '/notifications',
    { preHandler: deps.requireIdentity },
    async (request, reply) => {
      const identity = request.identity
      if (!identity) return reply.code(401).send()
      return store.notifications(identity)
    }
  )

  app.post(
    '/notifications/read',
    { preHandler: deps.requireIdentity },
    async (request, reply) => {
      const identity = request.identity
      if (!identity) return reply.code(401).send()
      const selection = readSelection.safeParse(request.body)
      if (!selection.success) return refuse(reply, 'invalid_request')
      await store.markRead(identity, selection.data)
      return reply.code(204).send()
    }
  )
}

import { z } from 'zod'
import type { Db } from '../../infra/db.ts'
import type { HttpServer } from '../../infra/http.ts'
import { refuse } from '../../infra/refusals.ts'
import type { RequireIdentity } from '../auth/index.ts'
import { createPageStore } from './store.ts'

const pageTitle = z.string().trim().min(1).max(200)

// Database pages come with their own ticket.
const newPage = z.object({
  title: pageTitle,
  kind: z.literal('document'),
  parentId: z.uuid().nullable(),
  afterId: z.uuid().optional(),
  beforeId: z.uuid().optional()
})

const wikiParams = z.object({ wikiId: z.uuid() })

const pageParams = z.object({ pageId: z.uuid() })

export function registerPages(
  app: HttpServer,
  deps: { db: Db; requireIdentity: RequireIdentity }
): void {
  const store = createPageStore(deps.db)

  app.post(
    '/wikis/:wikiId/pages',
    { preHandler: deps.requireIdentity },
    async (request, reply) => {
      const identity = request.identity
      if (!identity) return reply.code(401).send()
      const params = wikiParams.safeParse(request.params)
      if (!params.success) return refuse(reply, 'not_found')
      const body = newPage.safeParse(request.body)
      if (!body.success) {
        return reply.code(400).send({ error: 'invalid_request' })
      }
      const result = await store.createPage(
        identity,
        params.data.wikiId,
        body.data
      )
      if (!result.ok) return refuse(reply, result.error)
      return reply.code(201).send(result.value)
    }
  )

  app.get(
    '/pages/:pageId',
    { preHandler: deps.requireIdentity },
    async (request, reply) => {
      const identity = request.identity
      if (!identity) return reply.code(401).send()
      const params = pageParams.safeParse(request.params)
      if (!params.success) return refuse(reply, 'not_found')
      const page = await store.page(identity, params.data.pageId)
      return page ?? refuse(reply, 'not_found')
    }
  )
}

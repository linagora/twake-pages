import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import type { Db } from '../../infra/db.ts'
import type { HttpServer } from '../../infra/http.ts'
import { refuse } from '../../infra/refusals.ts'
import { storable } from '../../infra/text.ts'
import type { RequireIdentity } from '../auth/index.ts'
import { MAX_BLOCKS_BYTES, pageBlocks } from './blocks.ts'
import { createPageStore } from './store.ts'

const pageTitle = z.string().trim().min(1).max(200).refine(storable)

// Database pages come with their own ticket.
const newPage = z.object({
  title: pageTitle,
  kind: z.literal('document'),
  parentId: z.uuid().nullable(),
  afterId: z.uuid().optional(),
  beforeId: z.uuid().optional(),
  content: pageBlocks.default([])
})

const wikiParams = z.object({ wikiId: z.uuid() })

const pageParams = z.object({ pageId: z.uuid() })

// Every route that writes blocks gives its body room for 2 MiB of them and its
// other fields. Over that, Fastify refuses the body before the route reads it,
// and the client hears what it would hear of blocks over 2 MiB. The store
// checks the blocks themselves.
const blocksBody = {
  bodyLimit: MAX_BLOCKS_BYTES + 64 * 1024,
  errorHandler(
    error: FastifyError,
    _request: FastifyRequest,
    reply: FastifyReply
  ) {
    if (error.code !== 'FST_ERR_CTP_BODY_TOO_LARGE') throw error
    return refuse(reply, 'invalid_content')
  }
}

export function registerPages(
  app: HttpServer,
  deps: { db: Db; requireIdentity: RequireIdentity; gristOrigins: string[] }
): void {
  const store = createPageStore(deps.db, deps.gristOrigins)

  app.post(
    '/wikis/:wikiId/pages',
    { ...blocksBody, preHandler: deps.requireIdentity },
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

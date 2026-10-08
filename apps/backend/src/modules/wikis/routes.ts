import { z } from 'zod'
import type { Db } from '../../infra/db.ts'
import type { HttpServer } from '../../infra/http.ts'
import { refuse } from '../../infra/refusals.ts'
import { storable } from '../../infra/text.ts'
import type { RequireIdentity } from '../auth/index.ts'
import { createWikiStore } from './store.ts'

const wikiName = z.string().trim().min(1).max(100).refine(storable)

const wikiDescription = z.string().max(500).refine(storable)

const newWiki = z.object({
  name: wikiName,
  description: wikiDescription.default('')
})

const wikiEdit = z
  .object({ name: wikiName, description: wikiDescription })
  .partial()
  .refine(changes => Object.keys(changes).length > 0)

const wikiParams = z.object({ wikiId: z.uuid() })

export function registerWikis(
  app: HttpServer,
  deps: { db: Db; requireIdentity: RequireIdentity }
): void {
  const store = createWikiStore(deps.db)

  app.get(
    '/wikis',
    { preHandler: deps.requireIdentity },
    async (request, reply) => {
      const identity = request.identity
      if (!identity) return reply.code(401).send()
      return { wikis: await store.listWikis(identity) }
    }
  )

  app.post(
    '/wikis',
    { preHandler: deps.requireIdentity },
    async (request, reply) => {
      const identity = request.identity
      if (!identity) return reply.code(401).send()
      const body = newWiki.safeParse(request.body)
      if (!body.success) {
        return reply.code(400).send({ error: 'invalid_request' })
      }
      return reply.code(201).send(await store.createWiki(identity, body.data))
    }
  )

  app.get(
    '/wikis/:wikiId',
    { preHandler: deps.requireIdentity },
    async (request, reply) => {
      const identity = request.identity
      if (!identity) return reply.code(401).send()
      const params = wikiParams.safeParse(request.params)
      if (!params.success) return refuse(reply, 'not_found')
      const wiki = await store.wiki(identity, params.data.wikiId)
      return wiki ?? refuse(reply, 'not_found')
    }
  )

  app.get(
    '/wikis/:wikiId/tree',
    { preHandler: deps.requireIdentity },
    async (request, reply) => {
      const identity = request.identity
      if (!identity) return reply.code(401).send()
      const params = wikiParams.safeParse(request.params)
      if (!params.success) return refuse(reply, 'not_found')
      const tree = await store.tree(identity, params.data.wikiId)
      return tree ?? refuse(reply, 'not_found')
    }
  )

  app.patch(
    '/wikis/:wikiId',
    { preHandler: deps.requireIdentity },
    async (request, reply) => {
      const identity = request.identity
      if (!identity) return reply.code(401).send()
      const params = wikiParams.safeParse(request.params)
      if (!params.success) return refuse(reply, 'not_found')
      const body = wikiEdit.safeParse(request.body)
      if (!body.success) {
        return reply.code(400).send({ error: 'invalid_request' })
      }
      const result = await store.updateWiki(
        identity,
        params.data.wikiId,
        body.data
      )
      if (!result.ok) return refuse(reply, result.error)
      return result.value
    }
  )

  app.delete(
    '/wikis/:wikiId',
    { preHandler: deps.requireIdentity },
    async (request, reply) => {
      const identity = request.identity
      if (!identity) return reply.code(401).send()
      const params = wikiParams.safeParse(request.params)
      if (!params.success) return refuse(reply, 'not_found')
      const result = await store.deleteWiki(identity, params.data.wikiId)
      if (!result.ok) return refuse(reply, result.error)
      return reply.code(204).send()
    }
  )
}

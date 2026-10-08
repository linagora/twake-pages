import { z } from 'zod'
import type { Db } from '../../infra/db.ts'
import type { HttpServer } from '../../infra/http.ts'
import { refuse } from '../../infra/refusals.ts'
import type { RequireIdentity } from '../auth/index.ts'
import { createPageStore } from './store.ts'

const pageParams = z.object({ pageId: z.uuid() })

export function registerPages(
  app: HttpServer,
  deps: { db: Db; requireIdentity: RequireIdentity }
): void {
  const store = createPageStore(deps.db)

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

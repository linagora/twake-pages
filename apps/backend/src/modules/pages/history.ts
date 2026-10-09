import { desc, eq } from 'drizzle-orm'
import { inTenant, type Db } from '../../infra/db.ts'
import type { HttpServer } from '../../infra/http.ts'
import { refuse } from '../../infra/refusals.ts'
import type { Identity, RequireIdentity } from '../auth/index.ts'
import { pageParams } from './routes.ts'
import { pageVersions } from './schema.ts'
import { pageInReach, versionSummary } from './store.ts'

function createHistoryStore(db: Db) {
  return {
    /**
     * The page's versions, newest first, or null out of the person's reach.
     * Twake Tasks orders a task's history by time, as its changes have no
     * number: a version's number tells the order it was published in.
     */
    history(identity: Identity, pageId: string) {
      return inTenant(db, identity, async tx => {
        if (!(await pageInReach(tx, identity, pageId))) return null
        return tx
          .select(versionSummary)
          .from(pageVersions)
          .where(eq(pageVersions.pageId, pageId))
          .orderBy(desc(pageVersions.number))
      })
    }
  }
}

export function registerHistory(
  app: HttpServer,
  deps: { db: Db; requireIdentity: RequireIdentity }
): void {
  const store = createHistoryStore(deps.db)

  app.get(
    '/pages/:pageId/versions',
    { preHandler: deps.requireIdentity },
    async (request, reply) => {
      const identity = request.identity
      if (!identity) return reply.code(401).send()
      const params = pageParams.safeParse(request.params)
      if (!params.success) return refuse(reply, 'not_found')
      const versions = await store.history(identity, params.data.pageId)
      return versions ? { versions } : refuse(reply, 'not_found')
    }
  )
}

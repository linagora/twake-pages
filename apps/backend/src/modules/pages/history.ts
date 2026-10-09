import { desc, eq } from 'drizzle-orm'
import { z } from 'zod'
import { inTenant, type Db } from '../../infra/db.ts'
import type { HttpServer } from '../../infra/http.ts'
import { refuse } from '../../infra/refusals.ts'
import type { Identity, RequireIdentity } from '../auth/index.ts'
import { pageParams } from './routes.ts'
import { pageVersions } from './schema.ts'
import { pageInReach, versionOfPage, versionSummary } from './store.ts'

// Past the integers of its column, a number would fail the query: it names
// no version, as a malformed one.
const versionParams = pageParams.extend({
  number: z
    .string()
    .regex(/^[1-9]\d*$/)
    .transform(Number)
    .pipe(z.int32())
})

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
    },

    /**
     * The page's version with its title and content, as it was published, or
     * null out of the person's reach.
     */
    version(identity: Identity, pageId: string, number: number) {
      return inTenant(db, identity, async tx => {
        if (!(await pageInReach(tx, identity, pageId))) return null
        const [version] = await tx
          .select({
            ...versionSummary,
            content: pageVersions.content,
            gristUrl: pageVersions.gristUrl
          })
          .from(pageVersions)
          .where(versionOfPage(pageId, number))
        return version ?? null
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

  app.get(
    '/pages/:pageId/versions/:number',
    { preHandler: deps.requireIdentity },
    async (request, reply) => {
      const identity = request.identity
      if (!identity) return reply.code(401).send()
      const params = versionParams.safeParse(request.params)
      if (!params.success) return refuse(reply, 'not_found')
      const version = await store.version(
        identity,
        params.data.pageId,
        params.data.number
      )
      return version ?? refuse(reply, 'not_found')
    }
  )
}

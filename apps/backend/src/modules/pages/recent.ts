import { desc, eq } from 'drizzle-orm'
import { inTenant, type Db } from '../../infra/db.ts'
import type { HttpServer } from '../../infra/http.ts'
import type { Identity, RequireIdentity } from '../auth/index.ts'
import { pageRefOf, reachablePages } from './refs.ts'
import { pageVisits } from './schema.ts'

const RECENT_PAGES = 20

/**
 * The live pages in the person's reach they opened last, with when. Pages in
 * the trash or out of reach leave their place to older visits.
 */
function recentPages(db: Db, identity: Identity) {
  return inTenant(db, identity, tx => {
    const reachable = reachablePages(tx, identity.userId)
    return tx
      .select({ ...pageRefOf(reachable), visitedAt: pageVisits.visitedAt })
      .from(pageVisits)
      .innerJoin(reachable, eq(reachable.id, pageVisits.pageId))
      .where(eq(pageVisits.userId, identity.userId))
      .orderBy(desc(pageVisits.visitedAt))
      .limit(RECENT_PAGES)
  })
}

export function registerRecent(
  app: HttpServer,
  deps: { db: Db; requireIdentity: RequireIdentity }
): void {
  app.get(
    '/recent',
    { preHandler: deps.requireIdentity },
    async (request, reply) => {
      const identity = request.identity
      if (!identity) return reply.code(401).send()
      return { pages: await recentPages(deps.db, identity) }
    }
  )
}

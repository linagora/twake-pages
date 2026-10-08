import { and, eq } from 'drizzle-orm'
import { inTenant, type Db } from '../../infra/db.ts'
import type { HttpServer } from '../../infra/http.ts'
import { refuse } from '../../infra/refusals.ts'
import type { Identity, RequireIdentity } from '../auth/index.ts'
import { roleOn } from '../wikis/access.ts'
import { pageParams } from './routes.ts'
import { pageFavorites, pages } from './schema.ts'

function createFavoriteStore(db: Db) {
  return {
    /**
     * False for a page out of the person's reach. A page in the trash is in
     * reach, as it opens from there. Marked again, a page keeps the time it
     * was first marked, as Twake Tasks keeps a board's favorite.
     */
    setFavorite(identity: Identity, pageId: string, favorite: boolean) {
      return inTenant(db, identity, async tx => {
        const [page] = await tx
          .select({
            wikiId: pages.wikiId,
            organizationId: pages.organizationId
          })
          .from(pages)
          .where(eq(pages.id, pageId))
        if (!page || !(await roleOn(tx, identity, page.wikiId))) return false
        if (favorite) {
          await tx
            .insert(pageFavorites)
            .values({
              pageId,
              organizationId: page.organizationId,
              userId: identity.userId
            })
            .onConflictDoNothing()
        } else {
          await tx
            .delete(pageFavorites)
            .where(
              and(
                eq(pageFavorites.pageId, pageId),
                eq(pageFavorites.userId, identity.userId)
              )
            )
        }
        return true
      })
    }
  }
}

export function registerFavorites(
  app: HttpServer,
  deps: { db: Db; requireIdentity: RequireIdentity }
): void {
  const store = createFavoriteStore(deps.db)

  for (const [method, favorite] of [
    ['PUT', true],
    ['DELETE', false]
  ] as const) {
    app.route({
      method,
      url: '/pages/:pageId/favorite',
      preHandler: deps.requireIdentity,
      handler: async (request, reply) => {
        const identity = request.identity
        if (!identity) return reply.code(401).send()
        const params = pageParams.safeParse(request.params)
        if (!params.success) return refuse(reply, 'not_found')
        const found = await store.setFavorite(
          identity,
          params.data.pageId,
          favorite
        )
        if (!found) return refuse(reply, 'not_found')
        return reply.code(204).send()
      }
    })
  }
}

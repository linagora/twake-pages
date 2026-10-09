import { and, desc, eq } from 'drizzle-orm'
import { inTenant, type Db } from '../../infra/db.ts'
import type { HttpServer } from '../../infra/http.ts'
import { refuse } from '../../infra/refusals.ts'
import type { Identity, RequireIdentity } from '../auth/index.ts'
import { pageRefOf, reachablePages } from './refs.ts'
import { pageParams } from './routes.ts'
import { pageFavorites } from './schema.ts'
import { pageInReach } from './store.ts'

function createFavoriteStore(db: Db) {
  return {
    /**
     * False for a page out of the person's reach. A page in the trash is in
     * reach, as it opens from there. Marked again, a page keeps the time it
     * was first marked, as Twake Tasks keeps a board's favorite.
     */
    setFavorite(identity: Identity, pageId: string, favorite: boolean) {
      return inTenant(db, identity, async tx => {
        const page = await pageInReach(tx, identity, pageId)
        if (!page) return false
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
    },

    // Twake Tasks flags its favorite boards in the list of boards. Favorite
    // pages make a list of their own, across the person's wikis.
    favorites(identity: Identity) {
      return inTenant(db, identity, tx => {
        const reachable = reachablePages(tx, identity.userId)
        return tx
          .select(pageRefOf(reachable))
          .from(pageFavorites)
          .innerJoin(reachable, eq(reachable.id, pageFavorites.pageId))
          .where(eq(pageFavorites.userId, identity.userId))
          .orderBy(desc(pageFavorites.createdAt))
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

  app.get(
    '/favorites',
    { preHandler: deps.requireIdentity },
    async (request, reply) => {
      const identity = request.identity
      if (!identity) return reply.code(401).send()
      return { pages: await store.favorites(identity) }
    }
  )
}

import { and, eq } from 'drizzle-orm'
import { inTenant, type Db } from '../../infra/db.ts'
import type { HttpServer } from '../../infra/http.ts'
import { refuse } from '../../infra/refusals.ts'
import type { Identity, RequireIdentity } from '../auth/index.ts'
import { pageFollowers } from '../notifications/schema.ts'
import { pageParams } from './routes.ts'
import { follow, pageInReach } from './store.ts'

function createFollowingStore(db: Db) {
  return {
    /**
     * False for a page out of the person's reach. A page in the trash is in
     * reach, as it opens from there. No version moves, as for a favorite: a
     * follow shows to no one else.
     */
    setFollowing(identity: Identity, pageId: string, following: boolean) {
      return inTenant(db, identity, async tx => {
        const page = await pageInReach(tx, identity, pageId)
        if (!page) return false
        if (following) {
          await follow(
            tx,
            { id: pageId, organizationId: page.organizationId },
            identity.userId
          )
        } else {
          // No policy keeps the page's other followers from the person.
          await tx
            .delete(pageFollowers)
            .where(
              and(
                eq(pageFollowers.pageId, pageId),
                eq(pageFollowers.userId, identity.userId)
              )
            )
        }
        return true
      })
    }
  }
}

export function registerFollowing(
  app: HttpServer,
  deps: { db: Db; requireIdentity: RequireIdentity }
): void {
  const store = createFollowingStore(deps.db)

  for (const [method, following] of [
    ['PUT', true],
    ['DELETE', false]
  ] as const) {
    app.route({
      method,
      url: '/pages/:pageId/follow',
      preHandler: deps.requireIdentity,
      handler: async (request, reply) => {
        const identity = request.identity
        if (!identity) return reply.code(401).send()
        const params = pageParams.safeParse(request.params)
        if (!params.success) return refuse(reply, 'not_found')
        const found = await store.setFollowing(
          identity,
          params.data.pageId,
          following
        )
        if (!found) return refuse(reply, 'not_found')
        return reply.code(204).send()
      }
    })
  }
}

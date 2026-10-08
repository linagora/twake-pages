import { and, eq, isNull, sql } from 'drizzle-orm'
import { z } from 'zod'
import type { Changes, StreamVersions } from '../../infra/changes.ts'
import { inTenant, type Db, type Tx } from '../../infra/db.ts'
import type { HttpServer } from '../../infra/http.ts'
import { refuse, Refused } from '../../infra/refusals.ts'
import type { RequireIdentity } from '../auth/index.ts'
import { roleOn } from './access.ts'
import { wikis } from './schema.ts'

// Sent by the wikis_notify_change trigger.
export const WIKI_CHANNEL = 'wiki_changes'

/**
 * Moves the wiki's version in the transaction of a change to it, so the
 * people who show it reload it. Called before reading what the change depends
 * on, since its row lock makes concurrent changes to the wiki wait their turn.
 */
export async function bumpWiki(tx: Tx, wikiId: string) {
  const [wiki] = await tx
    .update(wikis)
    .set({ version: sql`${wikis.version} + 1` })
    .where(and(eq(wikis.id, wikiId), isNull(wikis.deletedAt)))
    .returning({ kind: wikis.kind })
  if (!wiki) throw new Refused('not_found')
  return wiki
}

const wikiParams = z.object({ wikiId: z.uuid() })

export function registerLive(
  app: HttpServer,
  deps: {
    db: Db
    requireIdentity: RequireIdentity
    changes: Changes
    streamVersions: StreamVersions
  }
) {
  app.get(
    '/wikis/:wikiId/stream',
    { preHandler: deps.requireIdentity },
    async (request, reply) => {
      const identity = request.identity
      if (!identity) return reply.code(401).send()
      const params = wikiParams.safeParse(request.params)
      if (!params.success) return refuse(reply, 'not_found')
      const { wikiId } = params.data
      const role = await inTenant(deps.db, identity, tx =>
        roleOn(tx, identity, wikiId)
      )
      if (!role) return refuse(reply, 'not_found')

      await deps.streamVersions(request, reply, {
        changes: deps.changes,
        key: wikiId,
        current: () =>
          inTenant(deps.db, identity, async tx => {
            const [row] = await tx
              .select({ version: wikis.version })
              .from(wikis)
              .where(eq(wikis.id, wikiId))
            if (!row) throw new Error(`wiki ${wikiId} is gone`)
            return row.version
          })
      })
    }
  )
}

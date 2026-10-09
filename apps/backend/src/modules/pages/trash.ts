import { sql } from 'drizzle-orm'
import type { Db, Tx } from '../../infra/db.ts'
import type { HttpServer } from '../../infra/http.ts'
import { Refused, refuse, writeOrRefuse } from '../../infra/refusals.ts'
import type { Identity, RequireIdentity } from '../auth/index.ts'
import { queuePageEvent } from './events.ts'
import { pageParams } from './routes.ts'
import { pages } from './schema.ts'
import { pageToChange } from './store.ts'

// The page and its live descendants go to the trash with one stamp, the page
// as the root of their branch, as Twake Tasks hides a task with its shown
// sub-tasks. A descendant deleted before keeps its own branch. Answers how
// many descendants went with the page.
async function putInTrash(tx: Tx, identity: Identity, pageId: string) {
  const branch = await tx.execute<{ id: string }>(sql`
    with recursive branch as (
      select id from ${pages} where id = ${pageId}
      union all
      select child.id from ${pages} child
      join branch on child.parent_id = branch.id
      where child.deleted_at is null
    )
    update ${pages}
    set deleted_at = now(), deleted_by = ${identity.userId},
      deleted_by_email = ${identity.email}, deleted_by_name = ${identity.name},
      trash_root_id = ${pageId}
    where id in (select id from branch)
    returning id`)
  return branch.length - 1
}

function createTrashStore(db: Db) {
  return {
    /** The page goes to the trash with its live descendants. */
    deletePage(identity: Identity, pageId: string) {
      return writeOrRefuse(db, identity, async tx => {
        // Read behind the wiki's row lock: of two deletes at the same time,
        // the later finds the page in the trash, and a child page created
        // just before goes with its parent.
        const page = await pageToChange(tx, identity, pageId)
        if (page.deletedAt !== null) throw new Refused('in_trash')
        if (page.home) throw new Refused('home_page')
        const descendants = await putInTrash(tx, identity, page.id)
        await queuePageEvent(tx, identity, 'deleted', page, { descendants })
        return null
      })
    }
  }
}

export function registerTrash(
  app: HttpServer,
  deps: { db: Db; requireIdentity: RequireIdentity }
): void {
  const store = createTrashStore(deps.db)

  app.delete(
    '/pages/:pageId',
    { preHandler: deps.requireIdentity },
    async (request, reply) => {
      const identity = request.identity
      if (!identity) return reply.code(401).send()
      const params = pageParams.safeParse(request.params)
      if (!params.success) return refuse(reply, 'not_found')
      const result = await store.deletePage(identity, params.data.pageId)
      if (!result.ok) return refuse(reply, result.error)
      return reply.code(204).send()
    }
  )
}

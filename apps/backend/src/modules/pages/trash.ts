import { and, desc, eq, isNull, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import { inTenant, type Db, type Tx } from '../../infra/db.ts'
import type { HttpServer } from '../../infra/http.ts'
import { positionBetween } from '../../infra/order.ts'
import { Refused, refuse, writeOrRefuse } from '../../infra/refusals.ts'
import type { Identity, RequireIdentity } from '../auth/index.ts'
import { roleOn } from '../wikis/access.ts'
import { queuePageEvent } from './events.ts'
import { pageParams, wikiParams } from './routes.ts'
import { pages } from './schema.ts'
import { pageToChange, siblingsUnder } from './store.ts'

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

// The root takes its new place while still in the trash, as the live pages
// under a parent each hold their own place and a page may hold the one the
// root left. The branch then comes out of the trash, and a branch deleted
// before under it stays there.
async function takeOutOfTrash(
  tx: Tx,
  rootId: string,
  place: { parentId: string | null; position: string }
) {
  await tx.update(pages).set(place).where(eq(pages.id, rootId))
  await tx
    .update(pages)
    .set({
      deletedAt: null,
      deletedBy: null,
      deletedByEmail: null,
      deletedByName: null,
      trashRootId: null
    })
    .where(eq(pages.trashRootId, rootId))
}

/** The parent while it is a live page, else null for the top of the tree. */
async function liveParentOf(tx: Tx, parentId: string | null) {
  if (parentId === null) return null
  const [parent] = await tx
    .select({ id: pages.id })
    .from(pages)
    .where(and(eq(pages.id, parentId), isNull(pages.deletedAt)))
  return parent?.id ?? null
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
    },

    /**
     * The branch comes back under the root's parent while the parent is
     * live, after its siblings, else at the top of the tree, last.
     */
    restorePage(identity: Identity, pageId: string) {
      return writeOrRefuse(db, identity, async tx => {
        // Read behind the wiki's row lock: of two restores at the same time,
        // the later finds the page out of the trash, and a parent deleted
        // just before sends the page to the top.
        const page = await pageToChange(tx, identity, pageId)
        if (page.trashRootId !== page.id) throw new Refused('not_in_trash')
        // Twake Tasks refuses to restore a task under a hidden parent. A page
        // goes to the top instead, so that any branch of the trash comes
        // back on its own, whatever became of its parent.
        const parentId = await liveParentOf(tx, page.parentId)
        const position = positionBetween(
          await siblingsUnder(tx, page.wikiId, parentId),
          undefined,
          undefined
        )
        await takeOutOfTrash(tx, page.id, { parentId, position })
        return { parentId, position }
      })
    },

    /**
     * The wiki's deleted branches, newest first, each by its root, or null
     * for a wiki out of the person's reach.
     */
    trash(identity: Identity, wikiId: string) {
      return inTenant(db, identity, async tx => {
        if (!(await roleOn(tx, identity, wikiId))) return null
        const branch = alias(pages, 'branch')
        return tx
          .select({
            id: pages.id,
            title: pages.title,
            deletedAt: pages.deletedAt,
            deletedBy: {
              id: pages.deletedBy,
              email: pages.deletedByEmail,
              name: pages.deletedByName
            },
            // The pages of the branch but its root.
            descendants: sql<number>`count(*)::int - 1`
          })
          .from(pages)
          .innerJoin(branch, eq(branch.trashRootId, pages.id))
          .where(and(eq(pages.wikiId, wikiId), eq(pages.trashRootId, pages.id)))
          .groupBy(pages.id)
          .orderBy(desc(pages.deletedAt), desc(pages.id))
      })
    }
  }
}

export function registerTrash(
  app: HttpServer,
  deps: { db: Db; requireIdentity: RequireIdentity }
): void {
  const store = createTrashStore(deps.db)

  app.get(
    '/wikis/:wikiId/trash',
    { preHandler: deps.requireIdentity },
    async (request, reply) => {
      const identity = request.identity
      if (!identity) return reply.code(401).send()
      const params = wikiParams.safeParse(request.params)
      if (!params.success) return refuse(reply, 'not_found')
      const listed = await store.trash(identity, params.data.wikiId)
      return listed ? { pages: listed } : refuse(reply, 'not_found')
    }
  )

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

  app.post(
    '/pages/:pageId/restore',
    { preHandler: deps.requireIdentity },
    async (request, reply) => {
      const identity = request.identity
      if (!identity) return reply.code(401).send()
      const params = pageParams.safeParse(request.params)
      if (!params.success) return refuse(reply, 'not_found')
      const result = await store.restorePage(identity, params.data.pageId)
      if (!result.ok) return refuse(reply, result.error)
      return result.value
    }
  )
}

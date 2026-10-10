import { and, desc, eq, inArray, isNull, notInArray, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import { z } from 'zod'
import { asTenant, inTenant, type Db, type Tx } from '../../infra/db.ts'
import type { HttpServer } from '../../infra/http.ts'
import { positionBetween } from '../../infra/order.ts'
import { Refused, refuse, writeOrRefuse } from '../../infra/refusals.ts'
import {
  schedule,
  unschedule,
  type Handler
} from '../../scheduler/scheduler.ts'
import { jobs } from '../../scheduler/schema.ts'
import type { Identity, RequireIdentity } from '../auth/index.ts'
import { checkRole, roleOn } from '../wikis/access.ts'
import { bumpWiki } from '../wikis/live.ts'
import { wikis } from '../wikis/schema.ts'
import { RETENTION_MS } from '../wikis/store.ts'
import { queuePageEvent } from './events.ts'
import { deleteUnusedLabels } from './labels.ts'
import { pageParams, wikiParams } from './routes.ts'
import { pageLabels, pages } from './schema.ts'
import { pageToChange, siblingsUnder } from './store.ts'

export const PURGE_PAGE_JOB = 'purge-page'

const purgeKeyOf = (rootId: string) => `${PURGE_PAGE_JOB}:${rootId}`

const purgePayload = z.object({
  pageId: z.uuid(),
  wikiId: z.uuid(),
  organizationId: z.string().nullable(),
  createdBy: z.uuid()
})

const trashPageParams = wikiParams.extend({ pageId: z.uuid() })

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
// before under it stays there. Answers how many descendants came back with
// the root.
async function takeOutOfTrash(
  tx: Tx,
  rootId: string,
  place: { parentId: string | null; position: string }
) {
  await tx.update(pages).set(place).where(eq(pages.id, rootId))
  const branch = await tx
    .update(pages)
    .set({
      deletedAt: null,
      deletedBy: null,
      deletedByEmail: null,
      deletedByName: null,
      trashRootId: null
    })
    .where(eq(pages.trashRootId, rootId))
    .returning({ id: pages.id })
  return branch.length - 1
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

/** The person who created the wiki. */
async function creatorOf(tx: Tx, wikiId: string) {
  const [wiki] = await tx
    .select({ createdBy: wikis.createdBy })
    .from(wikis)
    .where(eq(wikis.id, wikiId))
  if (!wiki) throw new Error(`wiki ${wikiId} is out of reach`)
  return wiki.createdBy
}

// The branches go for good, each page with what hangs off it by cascade, and
// the labels only they carried go too. A branch deleted before under one of
// them stays in the trash, and comes back at the top of the tree.
async function purgeBranches(tx: Tx, wikiId: string, rootIds: string[]) {
  const inBranches = and(
    eq(pages.wikiId, wikiId),
    inArray(pages.trashRootId, rootIds)
  )
  const carried = await tx
    .selectDistinct({ labelId: pageLabels.labelId })
    .from(pageLabels)
    .innerJoin(pages, eq(pages.id, pageLabels.pageId))
    .where(inBranches)
  await tx
    .update(pages)
    .set({ parentId: null })
    .where(
      and(
        inArray(
          pages.parentId,
          tx.select({ id: pages.id }).from(pages).where(inBranches)
        ),
        notInArray(pages.trashRootId, rootIds)
      )
    )
  await tx.delete(pages).where(inBranches)
  await deleteUnusedLabels(
    tx,
    carried.map(({ labelId }) => labelId)
  )
}

// Runs as the person the job names, for the reason deletePage gives. The
// branch of a wiki deleted since goes with the wiki, by the purge of the
// wiki. Whatever takes a branch out of the trash drops its job before it
// waits for the wiki's row lock, so it leaves behind the job of a branch
// deleted while it waited: that job finds its branch out of the trash, and
// leaves the wiki's version alone. The branch is read before the lock, as
// whatever would take it out of the trash drops this job first, and so
// waits for the job's row, which the scheduler holds.
export const purgePage: Handler = async (raw, tx) => {
  const job = purgePayload.parse(raw)
  await asTenant(tx, {
    organizationId: job.organizationId,
    userId: job.createdBy,
    email: ''
  })
  const [root] = await tx
    .select({ wikiId: pages.wikiId })
    .from(pages)
    .innerJoin(wikis, eq(wikis.id, pages.wikiId))
    .where(
      and(
        eq(pages.id, job.pageId),
        eq(pages.trashRootId, pages.id),
        isNull(wikis.deletedAt)
      )
    )
  if (!root) return undefined
  await bumpWiki(tx, root.wikiId)
  await purgeBranches(tx, root.wikiId, [job.pageId])
  return undefined
}

function createTrashStore(db: Db) {
  return {
    /** The page goes to the trash with its live descendants. */
    deletePage(identity: Identity, pageId: string) {
      return writeOrRefuse(db, identity, async tx => {
        // A restore that waited behind the page's last delete left that
        // delete's job: it is dropped before the wiki's row lock is taken, as
        // in restorePage, so that every route takes a job's row before the
        // wiki's. A refusal rolls it back.
        await unschedule(tx, purgeKeyOf(pageId))
        // Read behind the wiki's row lock: of two deletes at the same time,
        // the later finds the page in the trash, and a child page created
        // just before goes with its parent.
        const page = await pageToChange(tx, identity, pageId, 'editor')
        if (page.deletedAt !== null) throw new Refused('in_trash')
        if (page.home) throw new Refused('home_page')
        const descendants = await putInTrash(tx, identity, page.id)
        await queuePageEvent(tx, identity, 'deleted', page, { descendants })
        await schedule(tx, {
          kind: PURGE_PAGE_JOB,
          key: purgeKeyOf(page.id),
          payload: {
            pageId: page.id,
            wikiId: page.wikiId,
            organizationId: page.organizationId,
            // The purge runs as the wiki's creator, whom the wikis policy
            // always lets see the wiki, and so its pages: whoever deleted the
            // branch may have left a wiki outside any organization by then.
            createdBy: await creatorOf(tx, page.wikiId)
          },
          runAt: new Date(Date.now() + RETENTION_MS)
        })
        return null
      })
    },

    /**
     * The branch comes back under the root's parent while the parent is
     * live, after its siblings, else at the top of the tree, last.
     */
    restorePage(identity: Identity, pageId: string) {
      return writeOrRefuse(db, identity, async tx => {
        // Dropped before the wiki's row lock is taken, as a purge that falls
        // due holds its job's row while it waits for that lock: the other way
        // round, each would wait for the other. A refusal rolls it back.
        await unschedule(tx, purgeKeyOf(pageId))
        // Read behind the wiki's row lock: of two restores at the same time,
        // the later finds the page out of the trash, and a parent deleted
        // just before sends the page to the top.
        const page = await pageToChange(tx, identity, pageId, 'editor')
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
        const descendants = await takeOutOfTrash(tx, page.id, {
          parentId,
          position
        })
        await queuePageEvent(tx, identity, 'restored', page, { descendants })
        return { parentId, position }
      })
    },

    /** The branch goes for good, without waiting for its purge. */
    deleteForGood(identity: Identity, wikiId: string, pageId: string) {
      return writeOrRefuse(db, identity, async tx => {
        await checkRole(tx, identity, wikiId, 'admin')
        // Dropped before the wiki's row lock is taken, as in restorePage.
        await unschedule(tx, purgeKeyOf(pageId))
        await bumpWiki(tx, wikiId)
        const [page] = await tx
          .select({ id: pages.id, trashRootId: pages.trashRootId })
          .from(pages)
          .where(and(eq(pages.id, pageId), eq(pages.wikiId, wikiId)))
        if (!page) throw new Refused('not_found')
        if (page.trashRootId !== page.id) throw new Refused('not_in_trash')
        await purgeBranches(tx, wikiId, [page.id])
        return null
      })
    },

    /** Every branch of the wiki's trash goes for good. */
    emptyTrash(identity: Identity, wikiId: string) {
      return writeOrRefuse(db, identity, async tx => {
        await checkRole(tx, identity, wikiId, 'admin')
        // Dropped before the wiki's row lock is taken, as in restorePage.
        await tx
          .delete(jobs)
          .where(
            and(
              eq(jobs.kind, PURGE_PAGE_JOB),
              sql`${jobs.payload}->>'wikiId' = ${wikiId}`
            )
          )
        await bumpWiki(tx, wikiId)
        const roots = await tx
          .select({ id: pages.id })
          .from(pages)
          .where(and(eq(pages.wikiId, wikiId), eq(pages.trashRootId, pages.id)))
        await purgeBranches(
          tx,
          wikiId,
          roots.map(({ id }) => id)
        )
        return null
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

  app.delete(
    '/wikis/:wikiId/trash/:pageId',
    { preHandler: deps.requireIdentity },
    async (request, reply) => {
      const identity = request.identity
      if (!identity) return reply.code(401).send()
      const params = trashPageParams.safeParse(request.params)
      if (!params.success) return refuse(reply, 'not_found')
      const { wikiId, pageId } = params.data
      const result = await store.deleteForGood(identity, wikiId, pageId)
      if (!result.ok) return refuse(reply, result.error)
      return reply.code(204).send()
    }
  )

  app.delete(
    '/wikis/:wikiId/trash',
    { preHandler: deps.requireIdentity },
    async (request, reply) => {
      const identity = request.identity
      if (!identity) return reply.code(401).send()
      const params = wikiParams.safeParse(request.params)
      if (!params.success) return refuse(reply, 'not_found')
      const result = await store.emptyTrash(identity, params.data.wikiId)
      if (!result.ok) return refuse(reply, result.error)
      return reply.code(204).send()
    }
  )
}

import { and, asc, eq, sql } from 'drizzle-orm'
import { inTenant, type Db, type Tx } from '../../infra/db.ts'
import type { Identity } from '../auth/index.ts'
import { pageFollowers } from '../notifications/schema.ts'
import { roleOn } from '../wikis/access.ts'
import {
  labels,
  pageFavorites,
  pageLabels,
  pages,
  pageVersions,
  pageVisits
} from './schema.ts'

// Recent shows only the last pages a person opened, so older visits go.
const KEPT_VISITS = 100

// Versions keep their author's email and name, which stay when the author
// leaves the wiki.
async function authorOf(tx: Tx, pageId: string, number: number) {
  const [author] = await tx
    .select({
      id: pageVersions.authorId,
      email: pageVersions.authorEmail,
      name: pageVersions.authorName
    })
    .from(pageVersions)
    .where(
      and(eq(pageVersions.pageId, pageId), eq(pageVersions.number, number))
    )
  if (!author) {
    throw new Error(`page ${pageId} has no version ${String(number)}`)
  }
  return author
}

async function labelsOf(tx: Tx, pageId: string) {
  const rows = await tx
    .select({ name: labels.name })
    .from(pageLabels)
    .innerJoin(labels, eq(labels.id, pageLabels.labelId))
    .where(eq(pageLabels.pageId, pageId))
    .orderBy(asc(labels.name))
  return rows.map(row => row.name)
}

/** From the top of the tree down to the parent. */
async function ancestorsOf(tx: Tx, parentId: string | null) {
  if (parentId === null) return []
  const line = await tx.execute<{ id: string; title: string }>(sql`
    with recursive line as (
      select id, parent_id, title, 0 as depth from ${pages} where id = ${parentId}
      union all
      select parent.id, parent.parent_id, parent.title, line.depth + 1
      from ${pages} parent join line on parent.id = line.parent_id
    )
    select id, title from line order by depth desc`)
  return line.map(({ id, title }) => ({ id, title }))
}

async function recordVisit(
  tx: Tx,
  userId: string,
  page: { id: string; organizationId: string | null }
) {
  await tx
    .insert(pageVisits)
    .values({ pageId: page.id, organizationId: page.organizationId, userId })
    .onConflictDoUpdate({
      target: [pageVisits.userId, pageVisits.pageId],
      set: { visitedAt: sql`now()` }
    })
  // The function counts the visits of wikis the person left, which the
  // policies hide from this transaction in B2C.
  await tx.execute(sql`select app_trim_visits(${KEPT_VISITS})`)
}

export function createPageStore(db: Db) {
  return {
    /**
     * A page of a wiki the person is a member of, in the trash or not. Each
     * answer is a visit, for Recent.
     */
    page(identity: Identity, pageId: string) {
      return inTenant(db, identity, async tx => {
        const [row] = await tx
          .select({
            page: pages,
            following: sql<boolean>`${pageFollowers.userId} is not null`,
            favorite: sql<boolean>`${pageFavorites.userId} is not null`
          })
          .from(pages)
          .leftJoin(
            pageFollowers,
            and(
              eq(pageFollowers.pageId, pages.id),
              eq(pageFollowers.userId, identity.userId)
            )
          )
          .leftJoin(
            pageFavorites,
            and(
              eq(pageFavorites.pageId, pages.id),
              eq(pageFavorites.userId, identity.userId)
            )
          )
          .where(eq(pages.id, pageId))
        if (!row || !(await roleOn(tx, identity, row.page.wikiId))) return null
        const { page } = row
        await recordVisit(tx, identity.userId, page)
        return {
          id: page.id,
          wikiId: page.wikiId,
          parentId: page.parentId,
          home: page.home,
          kind: page.kind,
          title: page.title,
          content: page.content,
          gristUrl: page.gristUrl,
          version: page.version,
          createdAt: page.createdAt,
          createdBy: await authorOf(tx, page.id, 1),
          updatedAt: page.updatedAt,
          updatedBy: await authorOf(tx, page.id, page.version),
          labels: await labelsOf(tx, page.id),
          ancestors: await ancestorsOf(tx, page.parentId),
          following: row.following,
          favorite: row.favorite,
          deletedAt: page.deletedAt
        }
      })
    }
  }
}

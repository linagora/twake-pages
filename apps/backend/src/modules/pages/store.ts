import { and, asc, eq, isNull, sql } from 'drizzle-orm'
import { inTenant, type Db, type Tx } from '../../infra/db.ts'
import { positionBetween } from '../../infra/order.ts'
import { Refused, writeOrRefuse } from '../../infra/refusals.ts'
import type { Identity } from '../auth/index.ts'
import { pageFollowers } from '../notifications/schema.ts'
import { checkRole, roleOn } from '../wikis/access.ts'
import { bumpWiki } from '../wikis/live.ts'
import { checkBlocks, type Blocks } from './blocks.ts'
import { previewOf, queuePageEvent } from './events.ts'
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
const versionAuthor = {
  id: pageVersions.authorId,
  email: pageVersions.authorEmail,
  name: pageVersions.authorName
}

async function authorOf(tx: Tx, pageId: string, number: number) {
  const [author] = await tx
    .select(versionAuthor)
    .from(pageVersions)
    .where(
      and(eq(pageVersions.pageId, pageId), eq(pageVersions.number, number))
    )
  if (!author) {
    throw new Error(`page ${pageId} has no version ${String(number)}`)
  }
  return author
}

/** The contract's VersionSummary, as an edit conflict names it. */
async function summaryOf(tx: Tx, pageId: string, number: number) {
  const [version] = await tx
    .select({
      number: pageVersions.number,
      title: pageVersions.title,
      author: versionAuthor,
      createdAt: pageVersions.createdAt,
      restoredFrom: pageVersions.restoredFrom
    })
    .from(pageVersions)
    .where(
      and(eq(pageVersions.pageId, pageId), eq(pageVersions.number, number))
    )
  if (!version) {
    throw new Error(`page ${pageId} has no version ${String(number)}`)
  }
  return version
}

export type VersionSummary = Awaited<ReturnType<typeof summaryOf>>

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
export async function ancestorsOf(tx: Tx, parentId: string | null) {
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

/** A page of a wiki the person is a member of, in the trash or not. */
async function rowOf(tx: Tx, identity: Identity, pageId: string) {
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
  return row
}

async function pageOf(
  tx: Tx,
  { page, following, favorite }: NonNullable<Awaited<ReturnType<typeof rowOf>>>
) {
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
    following,
    favorite,
    deletedAt: page.deletedAt
  }
}

// For a change the person just made, so the page is in their reach.
async function changedPage(tx: Tx, identity: Identity, pageId: string) {
  const row = await rowOf(tx, identity, pageId)
  if (!row) throw new Error(`page ${pageId} is out of reach`)
  return pageOf(tx, row)
}

// The home page is outside the tree, so it takes no child page.
export async function checkParent(tx: Tx, wikiId: string, parentId: string) {
  const [parent] = await tx
    .select({ id: pages.id })
    .from(pages)
    .where(
      and(
        eq(pages.id, parentId),
        eq(pages.wikiId, wikiId),
        eq(pages.home, false),
        isNull(pages.deletedAt)
      )
    )
  if (!parent) throw new Refused('invalid_parent')
}

/** The live pages under the parent, or at the top of the tree, in order. */
export function siblingsUnder(tx: Tx, wikiId: string, parentId: string | null) {
  return tx
    .select({
      id: pages.id,
      // A check gives every page but the home page a position.
      position: sql<string>`${pages.position}`
    })
    .from(pages)
    .where(
      and(
        eq(pages.wikiId, wikiId),
        parentId === null
          ? isNull(pages.parentId)
          : eq(pages.parentId, parentId),
        eq(pages.home, false),
        isNull(pages.deletedAt)
      )
    )
    .orderBy(asc(pages.position))
}

/** Who writes a version: a person, or a space writing its wiki's home page. */
export type Author = Pick<Identity, 'userId' | 'email' | 'name'>

/** Writes the page's version, by its author, empty unless given blocks. */
async function writeVersion(
  tx: Tx,
  author: Author,
  version: {
    pageId: string
    organizationId: string | null
    number: number
    title: string
    content?: Blocks | undefined
    text?: string | undefined
  }
) {
  await tx.insert(pageVersions).values({
    ...version,
    authorId: author.userId,
    authorEmail: author.email,
    authorName: author.name
  })
}

/**
 * Writes a page of blocks in its wiki's tenant, with its version 1 by its
 * author, empty unless given checked blocks. The follower is the author, as
 * the creator of any page follows it, unless told otherwise.
 */
export async function addPage(
  tx: Tx,
  author: Author,
  page: {
    wikiId: string
    organizationId: string | null
    title: string
    content?: Blocks
    text?: string
    home?: true
    parentId?: string | null
    position?: string
  },
  follower: string | null = author.userId
) {
  const [added] = await tx
    .insert(pages)
    .values({
      ...page,
      kind: 'document',
      createdBy: author.userId,
      updatedBy: author.userId
    })
    .returning({
      id: pages.id,
      wikiId: pages.wikiId,
      organizationId: pages.organizationId,
      title: pages.title
    })
  if (!added) throw new Error('page insert returned nothing')
  await writeVersion(tx, author, {
    pageId: added.id,
    organizationId: added.organizationId,
    number: 1,
    title: added.title,
    content: page.content,
    text: page.text
  })
  if (follower !== null) {
    await tx.insert(pageFollowers).values({
      pageId: added.id,
      organizationId: added.organizationId,
      userId: follower
    })
  }
  return added
}

/** Where a page goes: under its parent, or at the top, between neighbours. */
export interface PageMove {
  parentId: string | null
  afterId?: string | undefined
  beforeId?: string | undefined
}

export interface NewPage extends PageMove {
  title: string
  /** Unchecked, until the store checks them. */
  content: Blocks
}

export interface NewVersion {
  /** The version the draft started from. */
  baseVersion: number
  title: string
  /** Unchecked, until the store checks them. */
  content: Blocks
}

export function createPageStore(db: Db, gristOrigins: readonly string[]) {
  return {
    /**
     * A page of a wiki the person is a member of, in the trash or not. Each
     * answer is a visit, for Recent.
     */
    page(identity: Identity, pageId: string) {
      return inTenant(db, identity, async tx => {
        const row = await rowOf(tx, identity, pageId)
        if (!row) return null
        await recordVisit(tx, identity.userId, row.page)
        return pageOf(tx, row)
      })
    },

    /** A page of blocks, version 1 by its creator, who follows it. */
    createPage(identity: Identity, wikiId: string, input: NewPage) {
      return writeOrRefuse(db, identity, async tx => {
        // Before the wiki's row lock, which 2 MiB of blocks to check would
        // hold longer.
        const blocks = checkBlocks(input.content, gristOrigins)
        await checkRole(tx, identity, wikiId, 'editor')
        const wiki = await bumpWiki(tx, wikiId)
        if (input.parentId !== null) {
          await checkParent(tx, wikiId, input.parentId)
        }
        const siblings = await siblingsUnder(tx, wikiId, input.parentId)
        const page = await addPage(tx, identity, {
          wikiId,
          organizationId: wiki.organizationId,
          title: input.title,
          ...blocks,
          parentId: input.parentId,
          position: positionBetween(siblings, input.afterId, input.beforeId)
        })
        await queuePageEvent(tx, identity, 'created', page, {
          preview: previewOf(blocks.text)
        })
        return changedPage(tx, identity, page.id)
      })
    },

    /** The page's next version, by the person who publishes it. */
    publish(identity: Identity, pageId: string, input: NewVersion) {
      return writeOrRefuse(db, identity, async tx => {
        // Before the wiki's row lock, as for a new page.
        const blocks = checkBlocks(input.content, gristOrigins)
        const [found] = await tx
          .select({ wikiId: pages.wikiId })
          .from(pages)
          .where(eq(pages.id, pageId))
        if (!found) throw new Refused('not_found')
        await checkRole(tx, identity, found.wikiId, 'editor')
        await bumpWiki(tx, found.wikiId)
        // Read after the lock, which every change to the wiki's pages takes,
        // as Twake Tasks reads a task's description version after its board's.
        const [page] = await tx
          .select({
            organizationId: pages.organizationId,
            kind: pages.kind,
            version: pages.version,
            deletedAt: pages.deletedAt
          })
          .from(pages)
          .where(eq(pages.id, pageId))
        if (!page) throw new Refused('not_found')
        if (page.deletedAt) throw new Refused('in_trash')
        // Blocks fit a page of blocks only: a database page's version takes
        // its Grist address instead (api.md).
        if (page.kind !== 'document') throw new Refused('invalid_request')
        if (page.version !== input.baseVersion) {
          throw new Refused('edit_conflict', {
            current: await summaryOf(tx, pageId, page.version)
          })
        }
        const number = page.version + 1
        await writeVersion(tx, identity, {
          pageId,
          organizationId: page.organizationId,
          number,
          title: input.title,
          ...blocks
        })
        await tx
          .update(pages)
          .set({
            title: input.title,
            ...blocks,
            version: number,
            updatedBy: identity.userId,
            updatedAt: sql`now()`
          })
          .where(eq(pages.id, pageId))
        await tx
          .insert(pageFollowers)
          .values({
            pageId,
            organizationId: page.organizationId,
            userId: identity.userId
          })
          .onConflictDoNothing()
        await queuePageEvent(
          tx,
          identity,
          'published',
          {
            id: pageId,
            wikiId: found.wikiId,
            organizationId: page.organizationId,
            title: input.title
          },
          { version: number, preview: previewOf(blocks.text) }
        )
        return changedPage(tx, identity, pageId)
      })
    }
  }
}

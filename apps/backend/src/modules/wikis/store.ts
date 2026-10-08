import { and, asc, desc, eq, isNotNull, isNull, sql } from 'drizzle-orm'
import { z } from 'zod'
import { asTenant, inTenant, type Db, type Tx } from '../../infra/db.ts'
import { Refused, writeOrRefuse, type Result } from '../../infra/refusals.ts'
import { schedule, type Handler } from '../../scheduler/scheduler.ts'
import type { Identity } from '../auth/index.ts'
import { notifications } from '../notifications/schema.ts'
import { pages, pageVersions } from '../pages/schema.ts'
import { accessibleWikis, checkRole, type Role } from './access.ts'
import { bumpWiki } from './live.ts'
import { wikiMembers, wikis } from './schema.ts'

export type WikiKind = 'personal' | 'shared' | 'space'

export interface WikiSummary {
  id: string
  name: string
  description: string
  kind: WikiKind
  role: Role
  homePageId: string
  unread: number
}

export interface Wiki extends WikiSummary {
  version: number
}

export interface TreePage {
  id: string
  parentId: string | null
  position: string
  title: string
  kind: 'document' | 'database'
}

const PERSONAL_WIKI_NAME = 'Personal'

export const PURGE_WIKI_JOB = 'purge-wiki'

const RETENTION_MS = 30 * 24 * 3600 * 1000

const purgePayload = z.object({
  wikiId: z.uuid(),
  organizationId: z.string().nullable(),
  createdBy: z.uuid()
})

// Runs as the wiki's creator, whom the wikis policy always lets see it. The
// pages, and all that hangs off them, go with the wiki by cascade.
export const purgeWiki: Handler = async (raw, tx) => {
  const job = purgePayload.parse(raw)
  await asTenant(tx, {
    organizationId: job.organizationId,
    userId: job.createdBy,
    email: ''
  })
  await tx
    .delete(wikis)
    .where(and(eq(wikis.id, job.wikiId), isNotNull(wikis.deletedAt)))
  return undefined
}

/**
 * Puts the wiki out of reach now, and purges it for good 30 days later. Its
 * version moves first, while bumpWiki still finds it.
 */
export async function putOutOfReach(tx: Tx, wikiId: string) {
  const bumped = await bumpWiki(tx, wikiId)
  const [wiki] = await tx
    .update(wikis)
    .set({ deletedAt: sql`now()` })
    .where(eq(wikis.id, wikiId))
    .returning({
      organizationId: wikis.organizationId,
      createdBy: wikis.createdBy
    })
  if (!wiki) throw new Error(`wiki ${wikiId} is out of reach`)
  await schedule(tx, {
    kind: PURGE_WIKI_JOB,
    key: `${PURGE_WIKI_JOB}:${wikiId}`,
    payload: { wikiId, ...wiki },
    runAt: new Date(Date.now() + RETENTION_MS)
  })
  return bumped
}

type Author = Pick<Identity, 'userId' | 'email' | 'name'>

export async function addHomePage(
  tx: Tx,
  author: Author,
  wiki: { id: string; organizationId: string | null; name: string }
): Promise<void> {
  const [home] = await tx
    .insert(pages)
    .values({
      wikiId: wiki.id,
      organizationId: wiki.organizationId,
      home: true,
      kind: 'document',
      title: wiki.name,
      createdBy: author.userId,
      updatedBy: author.userId
    })
    .returning({ id: pages.id })
  if (!home) throw new Error('no home page')
  await tx.insert(pageVersions).values({
    pageId: home.id,
    organizationId: wiki.organizationId,
    number: 1,
    title: wiki.name,
    authorId: author.userId,
    authorEmail: author.email,
    authorName: author.name
  })
}

async function ensurePersonalWiki(tx: Tx, identity: Identity) {
  const [personal] = await tx
    .insert(wikis)
    .values({
      organizationId: identity.organizationId,
      name: PERSONAL_WIKI_NAME,
      kind: 'personal',
      createdBy: identity.userId
    })
    .onConflictDoNothing()
    .returning({
      id: wikis.id,
      organizationId: wikis.organizationId,
      name: wikis.name
    })
  if (!personal) return
  await tx.insert(wikiMembers).values({
    wikiId: personal.id,
    organizationId: identity.organizationId,
    userId: identity.userId,
    email: identity.email,
    name: identity.name,
    role: 'admin'
  })
  await addHomePage(tx, identity, personal)
}

function wikisOf(tx: Tx, userId: string) {
  const accessible = accessibleWikis(tx, userId)
  return tx
    .select({
      id: wikis.id,
      name: wikis.name,
      description: wikis.description,
      kind: wikis.kind,
      role: accessible.role,
      homePageId: pages.id,
      unread: tx.$count(
        notifications,
        and(
          eq(notifications.wikiId, wikis.id),
          eq(notifications.userId, userId),
          isNull(notifications.readAt)
        )
      ),
      version: wikis.version
    })
    .from(wikis)
    .innerJoin(accessible, eq(accessible.wikiId, wikis.id))
    .innerJoin(pages, and(eq(pages.wikiId, wikis.id), eq(pages.home, true)))
    .$dynamic()
}

async function wikiOf(tx: Tx, userId: string, wikiId: string) {
  const [wiki] = await wikisOf(tx, userId).where(eq(wikis.id, wikiId))
  return wiki ?? null
}

// For a change the person just made, so the wiki is in their reach.
async function changedWiki(tx: Tx, userId: string, wikiId: string) {
  const wiki = await wikiOf(tx, userId, wikiId)
  if (!wiki) throw new Error(`wiki ${wikiId} is out of reach`)
  return wiki
}

const summaryOf = (wiki: Wiki): WikiSummary => ({
  id: wiki.id,
  name: wiki.name,
  description: wiki.description,
  kind: wiki.kind,
  role: wiki.role,
  homePageId: wiki.homePageId,
  unread: wiki.unread
})

export function createWikiStore(db: Db) {
  return {
    /**
     * The person's wikis, their personal one first. Signing in lands here, so
     * this also creates the personal wiki and claims the person's invites.
     */
    listWikis(identity: Identity): Promise<WikiSummary[]> {
      return inTenant(db, identity, async tx => {
        await ensurePersonalWiki(tx, identity)
        await tx.execute(sql`select app_claim_invites()`)
        if (identity.name !== null) {
          await tx
            .update(wikiMembers)
            .set({ name: identity.name })
            .where(
              and(
                eq(wikiMembers.userId, identity.userId),
                sql`${wikiMembers.name} is distinct from ${identity.name}`
              )
            )
        }
        const rows = await wikisOf(tx, identity.userId).orderBy(
          desc(sql`${wikis.kind} = 'personal'`),
          asc(wikis.name)
        )
        return rows.map(summaryOf)
      })
    },

    wiki(identity: Identity, wikiId: string): Promise<Wiki | null> {
      return inTenant(db, identity, tx => wikiOf(tx, identity.userId, wikiId))
    },

    /** The live pages of the wiki, but its home page, which is outside the tree. */
    tree(
      identity: Identity,
      wikiId: string
    ): Promise<{ version: number; pages: TreePage[] } | null> {
      return inTenant(db, identity, async tx => {
        // The version is read first, so a change committed before the pages
        // are read reaches the client again through the stream.
        const wiki = await wikiOf(tx, identity.userId, wikiId)
        if (!wiki) return null
        const tree = await tx
          .select({
            id: pages.id,
            parentId: pages.parentId,
            // A check gives every page but the home page a position.
            position: sql<string>`${pages.position}`,
            title: pages.title,
            kind: pages.kind
          })
          .from(pages)
          .where(
            and(
              eq(pages.wikiId, wikiId),
              eq(pages.home, false),
              isNull(pages.deletedAt)
            )
          )
          .orderBy(asc(pages.position), asc(pages.id))
        return { version: wiki.version, pages: tree }
      })
    },

    createWiki(
      identity: Identity,
      input: { name: string; description: string }
    ): Promise<Wiki> {
      return inTenant(db, identity, async tx => {
        const [wiki] = await tx
          .insert(wikis)
          .values({
            organizationId: identity.organizationId,
            ...input,
            kind: 'shared',
            createdBy: identity.userId
          })
          .returning({
            id: wikis.id,
            organizationId: wikis.organizationId,
            name: wikis.name
          })
        if (!wiki) throw new Error('no wiki')
        await tx.insert(wikiMembers).values({
          wikiId: wiki.id,
          organizationId: identity.organizationId,
          userId: identity.userId,
          email: identity.email,
          name: identity.name,
          role: 'admin'
        })
        await addHomePage(tx, identity, wiki)
        return changedWiki(tx, identity.userId, wiki.id)
      })
    },

    /** A space's wiki takes its name from the space. */
    updateWiki(
      identity: Identity,
      wikiId: string,
      changes: { name?: string | undefined; description?: string | undefined }
    ): Promise<Result<Wiki>> {
      return writeOrRefuse(db, identity, async tx => {
        await checkRole(tx, identity, wikiId, 'admin')
        const { kind } = await bumpWiki(tx, wikiId)
        if (kind === 'space' && changes.name !== undefined) {
          throw new Refused('managed')
        }
        await tx.update(wikis).set(changes).where(eq(wikis.id, wikiId))
        return changedWiki(tx, identity.userId, wikiId)
      })
    },

    /**
     * Puts a shared wiki out of reach, and purges it for good 30 days later.
     * A personal wiki goes with its person, a space's with its space.
     */
    deleteWiki(identity: Identity, wikiId: string): Promise<Result<null>> {
      return writeOrRefuse(db, identity, async tx => {
        await checkRole(tx, identity, wikiId, 'admin')
        const { kind } = await putOutOfReach(tx, wikiId)
        // The refusal rolls the deletion back.
        if (kind !== 'shared') throw new Refused('managed')
        return null
      })
    }
  }
}

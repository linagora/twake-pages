import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm'
import { inTenant, type Db, type Tx } from '../../infra/db.ts'
import type { Identity } from '../auth/index.ts'
import { notifications } from '../notifications/schema.ts'
import { pages, pageVersions } from '../pages/schema.ts'
import { accessibleWikis, type Role } from './access.ts'
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

const PERSONAL_WIKI_NAME = 'Personal'

type Author = Pick<Identity, 'userId' | 'email' | 'name'>

/** The empty home page of a new wiki, titled after it, at version 1. */
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
        const created = await wikiOf(tx, identity.userId, wiki.id)
        if (!created) throw new Error(`wiki ${wiki.id} is out of reach`)
        return created
      })
    }
  }
}

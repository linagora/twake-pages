import { randomUUID } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { pino } from 'pino'
import { inject } from 'vitest'
import { buildApp } from '../app.ts'
import { listenToChanges } from '../infra/changes.ts'
import { createDb, inTenant, type Db, type Tx } from '../infra/db.ts'
import type { Identity } from '../modules/auth/index.ts'
import { anIdentity } from '../modules/auth/testing.ts'
import { pages, pageVersions } from '../modules/pages/schema.ts'
import { SETTINGS_CHANNEL } from '../modules/settings/routes.ts'
import type { Role } from '../modules/wikis/access.ts'
import { WIKI_CHANNEL } from '../modules/wikis/live.ts'
import { wikiMembers, wikis } from '../modules/wikis/schema.ts'
import { addHomePage, PURGE_WIKI_JOB } from '../modules/wikis/store.ts'
import { jobs } from '../scheduler/schema.ts'

export interface TestUser {
  userId: string
  email: string
  organizationId: string | null
  name?: string | null
}

// Each test gets its own people and organizations, so tests share one database.
export function aUser(overrides: Partial<TestUser> = {}): TestUser {
  const unique = randomUUID()
  return {
    userId: unique,
    email: `user-${unique}@example.com`,
    organizationId: `org-${unique}`,
    ...overrides
  }
}

export function aB2cUser(): TestUser {
  return aUser({ organizationId: null })
}

/** Adds the person to the wiki, as its admin will by sharing it. */
export async function joinWiki(
  db: Db,
  admin: TestUser,
  wikiId: string,
  user: TestUser,
  role: Role
) {
  await inTenant(db, admin, tx =>
    tx.insert(wikiMembers).values({
      wikiId,
      organizationId: admin.organizationId,
      userId: user.userId,
      email: user.email,
      role
    })
  )
}

/** Takes the person out of the wiki, as its admin will by removing them. */
export async function removeFromWiki(
  db: Db,
  admin: TestUser,
  wikiId: string,
  user: TestUser
) {
  await inTenant(db, admin, tx =>
    tx
      .delete(wikiMembers)
      .where(
        and(eq(wikiMembers.wikiId, wikiId), eq(wikiMembers.userId, user.userId))
      )
  )
}

/** A space's wiki, whose name and members come from the space integration. */
export async function aSpaceWiki(
  db: Db,
  members: [TestUser, Role][]
): Promise<string> {
  const [first] = members
  if (!first) throw new Error('a space wiki needs members')
  const [someone] = first
  const organizationId = someone.organizationId
  return inTenant(db, someone, async tx => {
    const [wiki] = await tx
      .insert(wikis)
      .values({
        organizationId,
        name: 'Marketing',
        kind: 'space',
        createdBy: randomUUID()
      })
      .returning({
        id: wikis.id,
        organizationId: wikis.organizationId,
        name: wikis.name
      })
    if (!wiki) throw new Error('no wiki')
    await tx.insert(wikiMembers).values(
      members.map(([user, role]) => ({
        wikiId: wiki.id,
        organizationId,
        userId: user.userId,
        email: user.email,
        role
      }))
    )
    await addHomePage(tx, { ...someone, name: null }, wiki)
    return wiki.id
  })
}

/** A version of the page by its author, as publishing will write it. */
export async function addVersion(
  tx: Tx,
  author: TestUser,
  version: { pageId: string; number: number; title: string }
) {
  await tx.insert(pageVersions).values({
    ...version,
    organizationId: author.organizationId,
    authorId: author.userId,
    authorEmail: author.email,
    authorName: author.name ?? null
  })
}

/**
 * A page written straight into the wiki, as the pages routes will write it,
 * with its first version, in the trash on its own when `deleted`.
 */
export async function aPageIn(
  db: Db,
  author: TestUser,
  wikiId: string,
  page: { title: string; position: string; parentId?: string; deleted?: true }
): Promise<string> {
  return inTenant(db, author, async tx => {
    const [written] = await tx
      .insert(pages)
      .values({
        wikiId,
        organizationId: author.organizationId,
        parentId: page.parentId ?? null,
        kind: 'document',
        title: page.title,
        position: page.position,
        createdBy: author.userId,
        updatedBy: author.userId
      })
      .returning({ id: pages.id })
    if (!written) throw new Error('no page')
    await addVersion(tx, author, {
      pageId: written.id,
      number: 1,
      title: page.title
    })
    if (page.deleted) {
      await tx
        .update(pages)
        .set({
          deletedAt: new Date(),
          deletedBy: author.userId,
          trashRootId: written.id
        })
        .where(eq(pages.id, written.id))
    }
    return written.id
  })
}

/** A wiki as `GET /wikis` lists it. */
export interface WikiSummary {
  id: string
  name: string
  description: string
  kind: 'personal' | 'shared' | 'space'
  role: 'viewer' | 'editor' | 'admin'
  homePageId: string
  unread: number
}

/** A wiki as `GET /wikis/:wikiId` shows it. */
export interface Wiki extends WikiSummary {
  version: number
}

/** The job planned to purge the deleted wiki. */
export async function purgeJobOf(db: Db, wikiId: string) {
  const [job] = await db
    .select()
    .from(jobs)
    .where(eq(jobs.key, `${PURGE_WIKI_JOB}:${wikiId}`))
  if (!job) throw new Error(`no purge job for wiki ${wikiId}`)
  return job
}

/**
 * The wiki's row, deleted or not, until it is purged. The wikis policy shows
 * it to anyone of its organization, and in B2C to its creator.
 */
export function wikiRowsOf(db: Db, someone: TestUser, wikiId: string) {
  return inTenant(db, someone, tx =>
    tx
      .select({ id: wikis.id, version: wikis.version })
      .from(wikis)
      .where(eq(wikis.id, wikiId))
  )
}

/** The wiki's version, as `GET /wikis/:wikiId` shows it to the person. */
export async function versionOf(
  api: Awaited<ReturnType<typeof startApp>>,
  user: TestUser,
  wikiId: string
) {
  return (await api.as(user).get(`/wikis/${wikiId}`)).json<{
    version: number
  }>().version
}

/** The person's wikis, as `GET /wikis` lists them. */
export async function wikisOf(
  api: Awaited<ReturnType<typeof startApp>>,
  user: TestUser
) {
  return (await api.as(user).get('/wikis')).json<{ wikis: WikiSummary[] }>()
    .wikis
}

/** The Grist origin of the app the tests start. */
export const GRIST_ORIGIN = 'https://grist.example.com'

export async function startApp() {
  const { sql, db } = createDb(inject('databaseUrl'))
  const settingsChanges = await listenToChanges(sql, SETTINGS_CHANNEL)
  const wikiChanges = await listenToChanges(sql, WIKI_CHANNEL)
  const app = await buildApp({
    logger: pino({ level: 'silent' }),
    db,
    settingsChanges,
    wikiChanges,
    provider: {
      identify: () => Promise.resolve(null),
      verifyLogoutToken: () => Promise.reject(new Error('not in tests'))
    },
    authenticate: token =>
      Promise.resolve(
        anIdentity(
          JSON.parse(Buffer.from(token, 'base64url').toString()) as Identity
        )
      ),
    isReady: () => Promise.resolve(true),
    gristOrigins: [GRIST_ORIGIN]
  })

  function tokenOf(user: TestUser) {
    return Buffer.from(
      JSON.stringify({
        subject: user.userId,
        userId: user.userId,
        email: user.email,
        name: user.name ?? null,
        organizationId: user.organizationId,
        organizationRole: user.organizationId ? 'member' : null
      })
    ).toString('base64url')
  }

  function as(user: TestUser) {
    const headers = { authorization: `Bearer ${tokenOf(user)}` }
    return {
      get: (path: string) =>
        app.inject({ method: 'GET', url: `/api${path}`, headers }),
      post: (path: string, payload: object) =>
        app.inject({ method: 'POST', url: `/api${path}`, headers, payload }),
      patch: (path: string, payload: object) =>
        app.inject({ method: 'PATCH', url: `/api${path}`, headers, payload }),
      put: (path: string, payload: object = {}) =>
        app.inject({ method: 'PUT', url: `/api${path}`, headers, payload }),
      delete: (path: string, payload: object = {}) =>
        app.inject({ method: 'DELETE', url: `/api${path}`, headers, payload })
    }
  }

  return {
    as,
    tokenOf,
    listen: () => app.listen({ host: '127.0.0.1', port: 0 }),
    close: async () => {
      await app.close()
      await settingsChanges.close()
      await wikiChanges.close()
      await sql.end()
    }
  }
}

/** A shared wiki, made through the API by its admin. */
export async function aWikiOf(
  app: Awaited<ReturnType<typeof startApp>>,
  admin: TestUser,
  name = 'Handbook'
) {
  const response = await app.as(admin).post('/wikis', { name })
  return response.json<Wiki>()
}

/** What `createPage` sends, at the top of the tree unless it names a parent. */
export interface PageToCreate {
  title: string
  parentId?: string | null
  afterId?: string
  beforeId?: string
  content?: unknown[]
}

/** `POST /wikis/:wikiId/pages` by the person, for a page of blocks. */
export function createPage(
  app: Awaited<ReturnType<typeof startApp>>,
  user: TestUser,
  wikiId: string,
  page: PageToCreate
) {
  return app.as(user).post(`/wikis/${wikiId}/pages`, {
    kind: 'document',
    parentId: null,
    ...page
  })
}

/** BlockNote's styled text, here with no style. */
export const styled = (text: string) => ({ type: 'text', text, styles: {} })

/** A block as BlockNote writes it, with no content unless given some. */
export const aBlock = (type: string, fields: Record<string, unknown> = {}) => ({
  id: randomUUID(),
  type,
  props: {},
  children: [],
  ...fields
})

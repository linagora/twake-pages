import { randomUUID } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { generateNKeysBetween } from 'fractional-indexing'
import { pino } from 'pino'
import { inject } from 'vitest'
import { buildApp } from '../app.ts'
import { listenToChanges } from '../infra/changes.ts'
import { createDb, inTenant, type Db, type Tx } from '../infra/db.ts'
import type { Identity } from '../modules/auth/index.ts'
import { anIdentity } from '../modules/auth/testing.ts'
import type { Blocks } from '../modules/pages/blocks.ts'
import { pages, pageVersions } from '../modules/pages/schema.ts'
import type { PageMove } from '../modules/pages/store.ts'
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

/** Adds the person to the wiki, as sharing it does once they sign in. */
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

/**
 * Takes the person out of the wiki in the database alone, which keeps their
 * favorites and visits of its pages, unlike the sharing routes.
 */
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

/**
 * `DELETE /wikis/:wikiId/members/:userId` by the person: an admin removing
 * the member, or the member leaving.
 */
export function removeMember(
  app: Awaited<ReturnType<typeof startApp>>,
  someone: TestUser,
  wikiId: string,
  userId: string
) {
  return app.as(someone).delete(`/wikis/${wikiId}/members/${userId}`)
}

/**
 * What takes a member out of a wiki, done by its admin or by the member, with
 * the answer to the request.
 */
export type TakeOut = (
  app: Awaited<ReturnType<typeof startApp>>,
  admin: TestUser,
  wikiId: string,
  member: TestUser
) => ReturnType<typeof removeMember>

/** The ways a member leaves a shared wiki. */
export const WAYS_TO_LEAVE: [string, TakeOut][] = [
  [
    'removed by its admin',
    (app, admin, wikiId, member) =>
      removeMember(app, admin, wikiId, member.userId)
  ],
  [
    'by themself',
    (app, _admin, wikiId, member) =>
      removeMember(app, member, wikiId, member.userId)
  ]
]

/**
 * The ways a member ends out of a wiki, with who the member is: leaving it in
 * an organization or in B2C, or out with the deleted wiki.
 */
export const waysOutOfAWiki: [string, () => TestUser, TakeOut][] = [
  ...WAYS_TO_LEAVE.flatMap(
    ([way, takeOut]): [string, () => TestUser, TakeOut][] => [
      [`a wiki the person left, ${way}`, aUser, takeOut],
      [`a wiki the person left, ${way}, in B2C`, aB2cUser, takeOut]
    ]
  ),
  [
    'a deleted wiki',
    aUser,
    (app, admin, wikiId) => app.as(admin).delete(`/wikis/${wikiId}`)
  ]
]

/**
 * Someone in an organization, and someone in B2C, whose rows the database
 * keeps apart by wiki membership instead.
 */
export const someoneOfEachTenant: [string, () => TestUser][] = [
  ['in an organization', aUser],
  ['in B2C', aB2cUser]
]

/** Ids that name no page and no wiki: a malformed one, and an unknown one. */
export const malformedOrUnknownIds: [string, string][] = [
  ['a malformed id', 'not-an-id'],
  ['an unknown id', randomUUID()]
]

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

/** A version of the page by its author, as publishing writes it. */
async function addVersion(
  tx: Tx,
  author: TestUser,
  version: {
    pageId: string
    number: number
    title: string
    content?: Blocks | undefined
    gristUrl?: string | null
  }
) {
  await tx.insert(pageVersions).values({
    ...version,
    organizationId: author.organizationId,
    authorId: author.userId,
    authorEmail: author.email,
    authorName: author.name ?? null
  })
}

/** Puts the page in the trash on its own, as `DELETE /pages/:pageId` will. */
export async function putInTheTrash(tx: Tx, user: TestUser, pageId: string) {
  await tx
    .update(pages)
    .set({ deletedAt: new Date(), deletedBy: user.userId, trashRootId: pageId })
    .where(eq(pages.id, pageId))
}

/**
 * A page written straight into the wiki, as the pages routes will write it,
 * with its first version, in the trash on its own when `deleted`. Given a
 * Grist address, it is a database page. Its blocks, if given, go unchecked.
 */
export async function aPageIn(
  db: Db,
  author: TestUser,
  wikiId: string,
  page: {
    title: string
    position: string
    parentId?: string
    deleted?: true
    content?: Blocks
    gristUrl?: string
  }
): Promise<string> {
  const gristUrl = page.gristUrl ?? null
  return inTenant(db, author, async tx => {
    const [written] = await tx
      .insert(pages)
      .values({
        wikiId,
        organizationId: author.organizationId,
        parentId: page.parentId ?? null,
        kind: gristUrl === null ? 'document' : 'database',
        title: page.title,
        content: page.content,
        gristUrl,
        position: page.position,
        createdBy: author.userId,
        updatedBy: author.userId
      })
      .returning({ id: pages.id })
    if (!written) throw new Error('no page')
    await addVersion(tx, author, {
      pageId: written.id,
      number: 1,
      title: page.title,
      content: page.content,
      gristUrl
    })
    if (page.deleted) await putInTheTrash(tx, author, written.id)
    return written.id
  })
}

/**
 * The next version of a database page, with another Grist address, written
 * straight into the wiki as publishing will write it: by its number.
 */
export async function aGristVersionOf(
  db: Db,
  author: TestUser,
  pageId: string,
  gristUrl: string
): Promise<void> {
  await inTenant(db, author, async tx => {
    const [page] = await tx
      .select({ title: pages.title, version: pages.version })
      .from(pages)
      .where(eq(pages.id, pageId))
    if (!page) throw new Error('no page')
    const number = page.version + 1
    await addVersion(tx, author, {
      pageId,
      number,
      title: page.title,
      gristUrl
    })
    await tx
      .update(pages)
      .set({ gristUrl, version: number })
      .where(eq(pages.id, pageId))
  })
}

/**
 * `count` pages written straight into the wiki, side by side at the top of
 * its tree, each titled after its position unless `titleOf` says otherwise.
 * Their ids come in the order of their positions. They are written at once:
 * one after the other, a hundred pages outlast a test's time on a busy
 * machine.
 */
export function pagesIn(
  db: Db,
  author: TestUser,
  wikiId: string,
  count: number,
  titleOf: (position: string) => string = position => position
): Promise<string[]> {
  return Promise.all(
    generateNKeysBetween(null, null, count).map(position =>
      aPageIn(db, author, wikiId, { title: titleOf(position), position })
    )
  )
}

// No route serves a plain text whole: search quotes a few words of a page's,
// and none shows a version's. So the texts of a page and of its versions are
// read from their tables, the first version first.
export const textsOf = (db: Db, user: TestUser, pageId: string) =>
  inTenant(db, user, async tx => {
    const [page] = await tx
      .select({ text: pages.text })
      .from(pages)
      .where(eq(pages.id, pageId))
    const versions = await tx
      .select({ text: pageVersions.text })
      .from(pageVersions)
      .where(eq(pageVersions.pageId, pageId))
      .orderBy(pageVersions.number)
    return { page: page?.text, versions: versions.map(({ text }) => text) }
  })

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

/** A page as the lists across wikis show it, such as `GET /favorites`. */
export interface PageRef {
  id: string
  title: string
  wiki: Pick<WikiSummary, 'id' | 'name' | 'kind'>
}

/** A page as `GET /recent` lists it, with when the person opened it. */
export interface RecentPage extends PageRef {
  visitedAt: string
}

/** A person as the API names them. */
export interface Person {
  id: string
  email: string
  name: string | null
}

/** The person, as the API names them. */
export const personOf = (user: TestUser): Person => ({
  id: user.userId,
  email: user.email,
  name: user.name ?? null
})

/** A page as `GET /pages/:pageId` shows it. */
export interface Page {
  id: string
  wikiId: string
  parentId: string | null
  home: boolean
  kind: 'document' | 'database'
  title: string
  content: unknown[]
  gristUrl: string | null
  version: number
  createdAt: string
  createdBy: Person
  updatedAt: string
  updatedBy: Person
  labels: string[]
  ancestors: { id: string; title: string }[]
  following: boolean
  favorite: boolean
  deletedAt: string | null
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

/** The page, as `GET /pages/:pageId` shows it to the person. */
export async function pageOf(
  api: Awaited<ReturnType<typeof startApp>>,
  user: TestUser,
  pageId: string
) {
  return (await api.as(user).get(`/pages/${pageId}`)).json<Page>()
}

/**
 * The ids of the pages the person lists across wikis: their favorites, as
 * `GET /favorites` lists them, and their recent pages, as `GET /recent` does.
 */
export async function favoritesAndRecentOf(
  api: Awaited<ReturnType<typeof startApp>>,
  user: TestUser
) {
  const idsAt = async (path: string) =>
    (await api.as(user).get(path))
      .json<{ pages: PageRef[] }>()
      .pages.map(page => page.id)
  return {
    favorites: await idsAt('/favorites'),
    recent: await idsAt('/recent')
  }
}

/** The titles of the parent's children, in their order in the wiki's tree. */
export async function titlesUnder(
  api: Awaited<ReturnType<typeof startApp>>,
  user: TestUser,
  wikiId: string,
  parentId: string | null
) {
  const tree = (await api.as(user).get(`/wikis/${wikiId}/tree`)).json<{
    pages: { parentId: string | null; title: string }[]
  }>()
  return tree.pages
    .filter(page => page.parentId === parentId)
    .map(page => page.title)
}

/** The person's wikis, as `GET /wikis` lists them. */
export async function wikisOf(
  api: Awaited<ReturnType<typeof startApp>>,
  user: TestUser
) {
  return (await api.as(user).get('/wikis')).json<{ wikis: WikiSummary[] }>()
    .wikis
}

/** The person's personal wiki, which `GET /wikis` makes on their first visit. */
export async function personalWikiOf(
  api: Awaited<ReturnType<typeof startApp>>,
  user: TestUser
) {
  const personal = (await wikisOf(api, user)).find(
    wiki => wiki.kind === 'personal'
  )
  if (!personal) throw new Error('no personal wiki')
  return personal
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

/** `POST /wikis/:wikiId/invites` by the person, as an editor by default. */
export function invite(
  app: Awaited<ReturnType<typeof startApp>>,
  admin: TestUser,
  wikiId: string,
  email: string,
  role: Role = 'editor'
) {
  return app.as(admin).post(`/wikis/${wikiId}/invites`, { email, role })
}

/** Invites the person back into the wiki, which they join as they sign in. */
export async function backIn(
  app: Awaited<ReturnType<typeof startApp>>,
  admin: TestUser,
  member: TestUser,
  wikiId: string
) {
  await invite(app, admin, wikiId, member.email)
  await wikisOf(app, member)
}

/**
 * Whether the person follows the page, as `GET /pages/:pageId` shows it, and
 * how many of their notifications about its wiki are unread, as `GET /wikis`
 * counts them.
 */
export async function followingAndUnreadOf(
  app: Awaited<ReturnType<typeof startApp>>,
  user: TestUser,
  wikiId: string,
  pageId: string
) {
  const wiki = (await wikisOf(app, user)).find(listed => listed.id === wikiId)
  return {
    following: (await pageOf(app, user, pageId)).following,
    unread: wiki?.unread
  }
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

/** A page made through the API by the person, by its id. */
export async function aPage(
  app: Awaited<ReturnType<typeof startApp>>,
  user: TestUser,
  wikiId: string,
  page: PageToCreate
) {
  return (await createPage(app, user, wikiId, page)).json<{ id: string }>().id
}

/** `POST /pages/:pageId/move` by the person. */
export function movePage(
  app: Awaited<ReturnType<typeof startApp>>,
  user: TestUser,
  pageId: string,
  to: PageMove
) {
  return app.as(user).post(`/pages/${pageId}/move`, to)
}

/** A parent the test makes in or beside the person's wiki, by its id. */
type ParentOf = (test: {
  app: Awaited<ReturnType<typeof startApp>>
  db: Db
  user: TestUser
  wiki: { id: string; homePageId: string }
}) => Promise<string>

/**
 * The parents no page of the wiki goes under, which creating a page and
 * moving one answer invalid_parent for.
 */
export const INVALID_PARENTS: [string, ParentOf][] = [
  [
    'a page of another wiki',
    async ({ app, user }) => {
      const other = await aWikiOf(app, user, 'Other')
      return aPage(app, user, other.id, { title: 'Elsewhere' })
    }
  ],
  [
    'a page in the trash',
    ({ db, user, wiki }) =>
      aPageIn(db, user, wiki.id, {
        title: 'Drafts',
        position: 'a0',
        deleted: true
      })
  ],
  [
    'the home page, which is outside the tree',
    ({ wiki }) => Promise.resolve(wiki.homePageId)
  ],
  ['an unknown page', () => Promise.resolve(randomUUID())]
]

/**
 * The pages a test names as neighbours at the top of the wiki's tree: Plans
 * and Goals there, Q1 under Plans, and Drafts in the trash.
 */
export async function neighbourPagesIn(
  app: Awaited<ReturnType<typeof startApp>>,
  db: Db,
  user: TestUser,
  wikiId: string
) {
  const drafts = await aPageIn(db, user, wikiId, {
    title: 'Drafts',
    position: 'a0',
    deleted: true
  })
  const plans = await aPage(app, user, wikiId, { title: 'Plans' })
  const goals = await aPage(app, user, wikiId, { title: 'Goals' })
  const child = await aPage(app, user, wikiId, { title: 'Q1', parentId: plans })
  return { drafts, plans, goals, child }
}

export type NeighbourPages = Awaited<ReturnType<typeof neighbourPagesIn>>

/**
 * The neighbours that are not side by side at the top of the tree, which
 * creating a page and moving one answer stale_neighbours for.
 */
export const STALE_NEIGHBOURS: [
  string,
  (pages: NeighbourPages) => Pick<PageToCreate, 'afterId' | 'beforeId'>
][] = [
  ['a page under another parent', ({ child }) => ({ afterId: child })],
  ['a page in the trash', ({ drafts }) => ({ beforeId: drafts })],
  [
    'two siblings that are not next to each other',
    ({ plans, goals }) => ({ afterId: goals, beforeId: plans })
  ],
  ['an unknown page', () => ({ afterId: randomUUID() })]
]

/** What `publish` sends: a draft and the version it started from. */
export interface DraftToPublish {
  baseVersion: number
  title: string
  content: unknown[]
}

/** `POST /pages/:pageId/versions` by the person, for a page of blocks. */
export function publish(
  app: Awaited<ReturnType<typeof startApp>>,
  user: TestUser,
  pageId: string,
  draft: DraftToPublish
) {
  return app.as(user).post(`/pages/${pageId}/versions`, draft)
}

/** `PUT /pages/:pageId/labels` by the person. */
export function setLabels(
  app: Awaited<ReturnType<typeof startApp>>,
  user: TestUser,
  pageId: string,
  names: string[]
) {
  return app.as(user).put(`/pages/${pageId}/labels`, { names })
}

/** `POST /pages/:pageId/versions/:number/restore` by the person. */
export function restoreVersion(
  app: Awaited<ReturnType<typeof startApp>>,
  user: TestUser,
  pageId: string,
  number: number | string
) {
  return app
    .as(user)
    .post(`/pages/${pageId}/versions/${String(number)}/restore`, {})
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

/** A paragraph of plain text. */
export const paragraph = (text: string) =>
  aBlock('paragraph', { content: [styled(text)] })

import { randomUUID } from 'node:crypto'
import { pino } from 'pino'
import { inject } from 'vitest'
import { buildApp } from '../app.ts'
import { listenToChanges } from '../infra/changes.ts'
import { createDb, inTenant, type Db } from '../infra/db.ts'
import type { Identity } from '../modules/auth/index.ts'
import { anIdentity } from '../modules/auth/testing.ts'
import { SETTINGS_CHANNEL } from '../modules/settings/routes.ts'
import type { Role } from '../modules/wikis/access.ts'
import { wikiMembers, wikis } from '../modules/wikis/schema.ts'
import { addHomePage } from '../modules/wikis/store.ts'

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

/** Adds the person to the owner's wiki, as sharing will. */
export async function joinWiki(
  db: Db,
  owner: TestUser,
  wikiId: string,
  user: TestUser,
  role: Role
) {
  await inTenant(db, owner, tx =>
    tx.insert(wikiMembers).values({
      wikiId,
      organizationId: owner.organizationId,
      userId: user.userId,
      email: user.email,
      role
    })
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

export async function startApp() {
  const { sql, db } = createDb(inject('databaseUrl'))
  const settingsChanges = await listenToChanges(sql, SETTINGS_CHANNEL)
  const app = await buildApp({
    logger: pino({ level: 'silent' }),
    db,
    settingsChanges,
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
    isReady: () => Promise.resolve(true)
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
      await sql.end()
    }
  }
}

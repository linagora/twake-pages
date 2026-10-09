import { PostgreSqlContainer } from '@testcontainers/postgresql'
import { eq, sql as statement, type SQL } from 'drizzle-orm'
import { pgTable, text, uuid } from 'drizzle-orm/pg-core'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest'
import { notifications } from '../modules/notifications/schema.ts'
import {
  labels,
  pageFavorites,
  pages,
  pageVisits
} from '../modules/pages/schema.ts'
import { wikiMembers, wikis } from '../modules/wikis/schema.ts'
import {
  aB2cUser,
  aUser,
  aWikiOf,
  startApp,
  type TestUser
} from '../testing/app.ts'
import {
  assertRowLevelSecurity,
  createDb,
  currentUser,
  inTenant,
  isTransient,
  migrateDb,
  organizationId,
  tenantPolicy,
  type Db
} from './db.ts'

let api: Awaited<ReturnType<typeof startApp>>
const { sql, db } = createDb(inject('databaseUrl'))

beforeAll(async () => {
  api = await startApp()
})

afterAll(async () => {
  await api.close()
  await sql.end()
})

// A table of the tests' own, on a single connection that keeps it, so the
// tenant policy is checked whatever tables the app has.
const notes = pgTable('tenant_notes', {
  organizationId: organizationId(),
  owner: uuid('owner').notNull(),
  body: text('body').notNull()
})
const policy = tenantPolicy(
  notes.organizationId,
  statement`${notes.owner} = ${currentUser}`
)

describe('inTenant', () => {
  const session = postgres(inject('databaseUrl'), {
    max: 1,
    onnotice: () => undefined
  })
  const scoped: Db = drizzle({ client: session })

  beforeAll(async () => {
    await scoped.execute(
      statement`create temporary table tenant_notes (org_id text, owner uuid not null, body text not null)`
    )
    await scoped.execute(
      statement`alter table tenant_notes enable row level security`
    )
    await scoped.execute(
      statement`alter table tenant_notes force row level security`
    )
    await scoped.execute(
      statement`create policy tenant on tenant_notes using (${policy.using}) with check (${policy.withCheck})`
    )
  })

  afterAll(async () => {
    await session.end()
  })

  const write = (user: TestUser, organization = user.organizationId) =>
    inTenant(scoped, user, tx =>
      tx.insert(notes).values({
        organizationId: organization,
        owner: user.userId,
        body: user.email
      })
    )

  const seenBy = (user: TestUser) =>
    inTenant(scoped, user, tx => tx.select({ body: notes.body }).from(notes))

  it('only shows the rows of the current organization', async () => {
    const acme = aUser()
    const globex = aUser()
    await write(acme)
    await write(aB2cUser())

    expect(await seenBy(globex)).toEqual([])
    expect(await seenBy(acme)).toEqual([{ body: acme.email }])
  })

  it('refuses to write a row for another organization', async () => {
    const acme = aUser()
    const globex = aUser()

    await expect(write(acme, globex.organizationId)).rejects.toThrow()
    await expect(write(aB2cUser(), acme.organizationId)).rejects.toThrow()
  })

  it('keeps B2C users to the rows their scope lets them see', async () => {
    const alice = aB2cUser()
    const bob = aB2cUser()
    await write(alice)

    expect(await seenBy(alice)).toEqual([{ body: alice.email }])
    expect(await seenBy(bob)).toEqual([])
  })

  it('keeps the identity to its transaction', async () => {
    await seenBy(aUser())

    expect(
      await scoped.execute<{ organization: string | null }>(
        statement`select nullif(current_setting('app.org_id', true), '') as organization`
      )
    ).toEqual([{ organization: null }])
  })
})

function aWikiRow(creator: TestUser) {
  return {
    organizationId: creator.organizationId,
    name: 'Secret',
    kind: 'shared',
    createdBy: creator.userId
  } as const
}

const wikisSeenBy = (user: TestUser) =>
  inTenant(db, user, tx =>
    tx.select({ organizationId: wikis.organizationId }).from(wikis)
  )

const pagesSeenBy = (user: TestUser) =>
  inTenant(db, user, tx =>
    tx.select({ organizationId: pages.organizationId }).from(pages)
  )

const join = (wikiId: string, user: TestUser, organizationId: string | null) =>
  ({
    wikiId,
    organizationId,
    userId: user.userId,
    email: user.email,
    role: 'viewer'
  }) as const

describe('the tenant policies', () => {
  it('only shows the wikis and pages of the current organization', async () => {
    const acme = aUser()
    const globex = aUser()
    await aWikiOf(api, acme)
    await aWikiOf(api, aB2cUser())

    expect(await wikisSeenBy(globex)).toEqual([])
    expect(await pagesSeenBy(globex)).toEqual([])
    expect(await wikisSeenBy(acme)).toEqual([
      { organizationId: acme.organizationId }
    ])
    expect(await pagesSeenBy(acme)).toEqual([
      { organizationId: acme.organizationId }
    ])
  })

  it('refuses to write a wiki for another organization', async () => {
    const acme = aUser()

    await expect(
      inTenant(db, aUser(), tx => tx.insert(wikis).values(aWikiRow(acme)))
    ).rejects.toThrow()
    await expect(
      inTenant(db, aB2cUser(), tx => tx.insert(wikis).values(aWikiRow(acme)))
    ).rejects.toThrow()
  })

  it('never shows a B2C row to a request of an organization', async () => {
    const alice = aB2cUser()
    await aWikiOf(api, alice)
    const atWork = { ...alice, organizationId: aUser().organizationId }

    expect(await wikisSeenBy(atWork)).toEqual([])
    expect(await pagesSeenBy(atWork)).toEqual([])
  })

  it('keeps B2C users to the wikis they are members of', async () => {
    const alice = aB2cUser()
    const bob = aB2cUser()
    const { id: wikiId } = await aWikiOf(api, alice)

    expect(await wikisSeenBy(alice)).toEqual([{ organizationId: null }])
    expect(await pagesSeenBy(alice)).toEqual([{ organizationId: null }])
    expect(await wikisSeenBy(bob)).toEqual([])
    expect(await pagesSeenBy(bob)).toEqual([])
    await expect(
      inTenant(db, bob, tx =>
        tx.insert(wikiMembers).values(join(wikiId, bob, null))
      )
    ).rejects.toThrow()
  })

  it('shows a shared B2C wiki to its members', async () => {
    const alice = aB2cUser()
    const bob = aB2cUser()
    const { id: wikiId } = await aWikiOf(api, alice)
    await inTenant(db, alice, tx =>
      tx.insert(wikiMembers).values(join(wikiId, bob, null))
    )

    expect(await wikisSeenBy(bob)).toEqual([{ organizationId: null }])
    expect(await pagesSeenBy(bob)).toEqual([{ organizationId: null }])
    expect(
      await inTenant(db, bob, tx =>
        tx
          .select({ email: wikiMembers.email })
          .from(wikiMembers)
          .where(eq(wikiMembers.wikiId, wikiId))
      )
    ).toHaveLength(2)
  })

  it('shows B2C people their own personal wiki', async () => {
    const alice = aB2cUser()
    await inTenant(db, alice, tx =>
      tx.insert(wikis).values({ ...aWikiRow(alice), kind: 'personal' })
    )

    expect(await wikisSeenBy(alice)).toEqual([{ organizationId: null }])
    expect(await wikisSeenBy(aB2cUser())).toEqual([])
  })

  it('keeps each person’s notifications, favorites and visits to themselves', async () => {
    const alice = aUser()
    const bob = aUser({ organizationId: alice.organizationId })
    const { id: wikiId, homePageId: pageId } = await aWikiOf(api, alice)
    const own = (user: TestUser) => ({
      pageId,
      organizationId: alice.organizationId,
      userId: user.userId
    })
    await inTenant(db, alice, async tx => {
      await tx
        .insert(wikiMembers)
        .values(join(wikiId, bob, alice.organizationId))
      await tx.insert(pageFavorites).values(own(alice))
      await tx.insert(pageVisits).values(own(alice))
    })
    // Anyone who sees the page notifies its followers, as publishing does.
    await inTenant(db, bob, tx =>
      tx.insert(notifications).values({
        ...own(alice),
        wikiId,
        reason: 'published',
        actorId: bob.userId,
        actorEmail: bob.email,
        version: 2
      })
    )
    const notificationsOf = (user: TestUser) =>
      inTenant(db, user, tx =>
        tx.select({ readAt: notifications.readAt }).from(notifications)
      )

    await inTenant(db, bob, tx =>
      tx.update(notifications).set({ readAt: new Date() })
    )
    expect(await notificationsOf(alice)).toEqual([{ readAt: null }])
    expect(await notificationsOf(bob)).toEqual([])
    expect(
      await inTenant(db, bob, tx => tx.select().from(pageFavorites))
    ).toEqual([])
    expect(await inTenant(db, bob, tx => tx.select().from(pageVisits))).toEqual(
      []
    )
    await expect(
      inTenant(db, bob, tx => tx.insert(pageFavorites).values(own(alice)))
    ).rejects.toThrow()
    await expect(
      inTenant(db, bob, tx => tx.insert(pageVisits).values(own(alice)))
    ).rejects.toThrow()
  })
})

describe('the invites policy', () => {
  const ROW_LEVEL_SECURITY_VIOLATION = '42501'
  const inviteTo = (wikiId: string, by: TestUser, email: string) =>
    inTenant(db, by, tx =>
      tx.execute(
        statement`insert into wiki_invites (wiki_id, org_id, email, role, invited_by)
          values (${wikiId}, ${by.organizationId}, ${email}, 'viewer', ${by.userId})`
      )
    )

  it('lets B2C users claim an invite to a wiki they cannot see yet', async () => {
    const alice = aB2cUser()
    const bob = aB2cUser()
    const { id: wikiId } = await aWikiOf(api, alice)
    await inviteTo(wikiId, alice, bob.email)

    await inTenant(db, bob, tx =>
      tx.execute(statement`select app_claim_invites()`)
    )

    expect(await wikisSeenBy(bob)).toEqual([{ organizationId: null }])
  })

  it('keeps B2C users from inviting themselves to a wiki they cannot see', async () => {
    const alice = aB2cUser()
    const mallory = aB2cUser()
    const { id: wikiId } = await aWikiOf(api, alice)

    await expect(
      inviteTo(wikiId, mallory, mallory.email)
    ).rejects.toHaveProperty('cause.code', ROW_LEVEL_SECURITY_VIOLATION)
  })

  it('keeps B2C users from raising the role of an invite to them', async () => {
    const alice = aB2cUser()
    const bob = aB2cUser()
    const { id: wikiId } = await aWikiOf(api, alice)
    await inviteTo(wikiId, alice, bob.email)

    await expect(
      inTenant(db, bob, tx =>
        tx.execute(
          statement`update wiki_invites set role = 'admin' where wiki_id = ${wikiId}`
        )
      )
    ).rejects.toHaveProperty('cause.code', ROW_LEVEL_SECURITY_VIOLATION)
  })
})

describe('tenant foreign keys', () => {
  const FOREIGN_KEY_VIOLATION = '23503'
  const stray: Record<
    string,
    (ids: { wikiId: string; pageId: string; labelId: string }) => SQL
  > = {
    wiki_members: ({ wikiId }) =>
      statement`insert into wiki_members (wiki_id, org_id, user_id, email, role)
         values (${wikiId}, null, uuidv7(), 'stray@example.com', 'viewer')`,
    wiki_invites: ({ wikiId }) =>
      statement`insert into wiki_invites (wiki_id, org_id, email, role, invited_by)
         values (${wikiId}, null, 'stray@example.com', 'viewer', uuidv7())`,
    invite_emails: ({ wikiId }) =>
      statement`insert into invite_emails (wiki_id, org_id, email, invited_by)
         values (${wikiId}, null, 'stray@example.com', uuidv7())`,
    pages: ({ wikiId }) =>
      statement`insert into pages (wiki_id, org_id, kind, title, position, created_by, updated_by)
         values (${wikiId}, null, 'document', 'Stray', 'z0', uuidv7(), uuidv7())`,
    labels: ({ wikiId }) =>
      statement`insert into labels (wiki_id, org_id, name)
         values (${wikiId}, null, 'stray')`,
    page_versions: ({ pageId }) =>
      statement`insert into page_versions (page_id, org_id, number, title, author_id, author_email)
         values (${pageId}, null, 99, 'Stray', uuidv7(), 'stray@example.com')`,
    page_labels: ({ pageId, labelId }) =>
      statement`insert into page_labels (page_id, label_id, org_id)
         values (${pageId}, ${labelId}, null)`,
    page_favorites: ({ pageId }) =>
      statement`insert into page_favorites (page_id, org_id, user_id)
         values (${pageId}, null, uuidv7())`,
    page_visits: ({ pageId }) =>
      statement`insert into page_visits (page_id, org_id, user_id)
         values (${pageId}, null, uuidv7())`,
    comments: ({ pageId }) =>
      statement`insert into comments (page_id, org_id, author_id, author_email, body)
         values (${pageId}, null, uuidv7(), 'stray@example.com', 'Stray')`,
    page_followers: ({ pageId }) =>
      statement`insert into page_followers (page_id, org_id, user_id)
         values (${pageId}, null, uuidv7())`,
    notifications: ({ wikiId, pageId }) =>
      statement`insert into notifications (page_id, wiki_id, org_id, user_id, reason, actor_id, actor_email)
         values (${pageId}, ${wikiId}, null, uuidv7(), 'published', uuidv7(), 'stray@example.com')`,
    spaces: ({ wikiId }) =>
      statement`insert into spaces (id, org_id, wiki_id)
         values (uuidv7(), 'org-stray', ${wikiId})`
  }

  // Row level security already refuses these, so it is lifted to reach the keys.
  it.each(Object.entries(stray))(
    'refuses a row in %s that points into another tenant',
    async (table, insert) => {
      const admin = aUser()
      const { id: wikiId, homePageId: pageId } = await aWikiOf(api, admin)
      const [label] = await inTenant(db, admin, tx =>
        tx
          .insert(labels)
          .values({ wikiId, organizationId: admin.organizationId, name: 'ops' })
          .returning({ id: labels.id })
      )

      await expect(
        db.transaction(async tx => {
          await tx.execute(
            statement`alter table ${statement.identifier(table)} no force row level security`
          )
          await tx.execute(insert({ wikiId, pageId, labelId: label?.id ?? '' }))
          tx.rollback()
        })
      ).rejects.toHaveProperty('cause.code', FOREIGN_KEY_VIOLATION)
    }
  )
})

describe('assertRowLevelSecurity', () => {
  it('accepts the app role, which is not a superuser', async () => {
    await expect(assertRowLevelSecurity(sql)).resolves.toBeUndefined()
  })

  it('forces row level security wherever it is enabled', async () => {
    const unforced = await sql`
      select relname from pg_class
      where relnamespace = 'public'::regnamespace
        and relrowsecurity and not relforcerowsecurity`

    expect(unforced).toEqual([])
  })
})

describe('isTransient', () => {
  const failure = (work: Promise<unknown>) =>
    work.then(
      () => {
        throw new Error('expected a failure')
      },
      (error: unknown) => error
    )
  const raise = (code: string) =>
    failure(
      db.execute(
        statement.raw(
          `do $$ begin raise exception 'boom' using errcode = '${code}'; end $$`
        )
      )
    )

  it('holds for a database that cannot be reached', async () => {
    const down = createDb('postgres://app:app@127.0.0.1:1/pages')
    try {
      expect(
        isTransient(await failure(down.db.execute(statement`select 1`)))
      ).toBe(true)
    } finally {
      await down.sql.end()
    }
  })

  it.each(['40001', '40P01', '55P03', '57014', '57P01', '53300', '08006'])(
    'holds for SQLSTATE %s',
    async code => {
      expect(isTransient(await raise(code))).toBe(true)
    }
  )

  it.each(['23505', '22P02', 'P0001'])(
    'does not hold for SQLSTATE %s',
    async code => {
      expect(isTransient(await raise(code))).toBe(false)
    }
  )

  it('does not hold for a plain error', () => {
    expect(isTransient(new Error('bug'))).toBe(false)
  })
})

describe('migrateDb', () => {
  it('migrates a Postgres 16 database, whose rows still get v7 ids', async () => {
    const container = await new PostgreSqlContainer('postgres:16').start()
    const admin = postgres(container.getConnectionUri(), {
      onnotice: () => undefined
    })
    await admin.unsafe(`create role app login password 'app'`)
    await admin.unsafe(`create database pages owner app`)
    await admin.end()
    const url = new URL(container.getConnectionUri())
    url.username = 'app'
    url.password = 'app'
    url.pathname = '/pages'
    const old = createDb(url.toString())
    try {
      await migrateDb(old.db)
      const [first, second] = await old.db.execute<{ id: string }>(
        statement`insert into jobs (kind, payload, run_at)
          values ('probe', '{}', now()), ('probe', '{}', now())
          returning id`
      )

      expect(first?.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7/)
      expect(second?.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7/)
    } finally {
      await old.sql.end()
      await container.stop()
    }
  }, 120_000)
})

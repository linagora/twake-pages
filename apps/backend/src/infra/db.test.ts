import { PostgreSqlContainer } from '@testcontainers/postgresql'
import { sql as statement } from 'drizzle-orm'
import { pgTable, text, uuid } from 'drizzle-orm/pg-core'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest'
import { aB2cUser, aUser, type TestUser } from '../testing/app.ts'
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

const { sql, db } = createDb(inject('databaseUrl'))

afterAll(async () => {
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

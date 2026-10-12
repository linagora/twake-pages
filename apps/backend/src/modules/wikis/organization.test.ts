import { randomUUID } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest'
import type { PlatformEvent } from '../../events/envelope.ts'
import { asTenant, createDb, type Tx } from '../../infra/db.ts'
import {
  aUser,
  purgeJobOf,
  startApp,
  type TestUser
} from '../../testing/app.ts'
import { accountRoutes } from './accounts.ts'

let api: Awaited<ReturnType<typeof startApp>>
const { sql: client, db } = createDb(inject('databaseUrl'))

beforeAll(async () => {
  api = await startApp()
})

afterAll(async () => {
  await api.close()
  await client.end()
})

/** A promise, and the two ends that reach and open its gate. */
function aGate() {
  let open!: () => void
  const opened = new Promise<void>(resolve => {
    open = resolve
  })
  let reached!: () => void
  const arrived = new Promise<void>(resolve => {
    reached = resolve
  })
  return { opened, arrived, open, reached }
}

const aWhile = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

/** Waits until the transaction `pid` reports waits its turn for a lock. */
async function waitingOnALock(pid: () => number): Promise<void> {
  for (let attempt = 0; attempt < 300; attempt++) {
    const id = pid()
    if (id !== 0) {
      const [row] = await db.execute<{ waiting: boolean }>(sql`
        select exists (
          select 1 from pg_stat_activity
          where pid = ${id} and wait_event_type = 'Lock'
        ) as waiting`)
      if (row?.waiting) return
    }
    await aWhile(10)
  }
  throw new Error('the request never waited for a lock')
}

/** Runs the person's work under the tenant their rows need. */
async function asPerson(tx: Tx, person: TestUser) {
  await asTenant(tx, {
    organizationId: person.organizationId,
    userId: person.userId,
    email: person.email
  })
}

/** A shared wiki, made through the API by its admin. */
async function aWiki(admin: TestUser, name: string) {
  return (await api.as(admin).post('/wikis', { name })).json<{ id: string }>()
}

const anOrganizationDeleted = (organizationId: string): PlatformEvent => ({
  routingKey: 'domain.organization.deleted',
  messageId: randomUUID(),
  body: { organizationId }
})

describe('an organization deleted while a wiki waits to be purged', () => {
  it('takes its jobs before its wikis, so the due purge takes its turn', async () => {
    const admin = aUser()
    const organizationId = admin.organizationId
    if (!organizationId) throw new Error('the test needs an organization')
    const wiki = await aWiki(admin, 'Minutes')
    await api.as(admin).delete(`/wikis/${wiki.id}`)
    const job = await purgeJobOf(db, wiki.id)
    const deleted = accountRoutes.get('domain.organization.deleted')
    if (!deleted) throw new Error('no handler for domain.organization.deleted')

    // The purge, as the scheduler runs it: it takes the job's row, then the
    // wiki's, which its delete needs, as the wiki's creator sees it. The gate
    // holds it between the two.
    const purgeMayGo = aGate()
    const purge = db.transaction(async tx => {
      await asPerson(tx, admin)
      await tx.execute(sql`select 1 from jobs where id = ${job.id} for update`)
      purgeMayGo.reached()
      await purgeMayGo.opened
      await tx.execute(sql`
        delete from wikis
        where id = ${wiki.id} and deleted_at is not null`)
    })

    // The deletion, in a transaction of its own, which the test watches to
    // know when it waits. Its first delete takes the jobs, then the wikis: the
    // order that keeps the two from waiting for each other. Reversed, the
    // deletion would hold the wiki the purge waits for while the purge holds
    // the job it waits for, which Postgres aborts as a deadlock.
    let pid = 0
    await purgeMayGo.arrived
    const deletion = db.transaction(async tx => {
      const [row] = await tx.execute<{ pid: number }>(
        sql`select pg_backend_pid() as pid`
      )
      pid = row?.pid ?? 0
      await deleted(anOrganizationDeleted(organizationId), tx)
    })
    await waitingOnALock(() => pid)
    purgeMayGo.open()

    await expect(deletion).resolves.toBeUndefined()
    await expect(purge).resolves.toBeUndefined()
    expect(await purgeJobOf(db, wiki.id).catch(() => null)).toBeNull()
  })
})

import { randomUUID } from 'node:crypto'
import { eq, sql } from 'drizzle-orm'
import type { PlatformEvent } from '../../events/envelope.ts'
import { inTenant, type Db } from '../../infra/db.ts'
import type { TestUser } from '../../testing/app.ts'
import { accountRoutes } from './accounts.ts'
import { wikis } from './schema.ts'

/**
 * Waits until `count` requests wait their turn, one behind the other, at the
 * change's row of `wikis`. The chain the requests make counts only while it
 * waits on that row: the first request waits on the change's transaction id
 * (the tuple lock on its `wikis` row), the next on the first's, and so on,
 * while a statement another test file runs may wait behind a request on a
 * table of its own. `db.test.ts`'s `ALTER TABLE wiki_members ... row level
 * security` does, so counting every statement in the chain would see it as
 * one more request and let the wiki go before the last one waits: the filter
 * keeps the waits that are the wiki's, the change's transaction id or a lock
 * on `wikis`.
 */
async function waitingBehind(db: Db, pid: number, count: number) {
  for (;;) {
    const [behind] = await db.execute<{ count: number }>(sql`
      with recursive behind as (
        select pid from pg_stat_activity
        where ${pid} = any(pg_blocking_pids(pid))
        union
        select activity.pid from pg_stat_activity activity
        join behind on behind.pid = any(pg_blocking_pids(activity.pid))
      )
      select count(*)::int as count from behind
      where exists (
        select 1 from pg_locks held
        where held.pid = behind.pid and not held.granted
          and (held.transactionid is not null
            or held.relation = 'wikis'::regclass))`)
    if (behind && behind.count >= count) return
    await new Promise(resolve => setTimeout(resolve, 10))
  }
}

/**
 * Sends the requests while a transaction holds the wiki's row lock, as a
 * change to the wiki does, each once the one before waits its turn, then
 * ends the transaction. It locks the row without changing it, so the first
 * request sent takes the row before the others: behind a row that changed,
 * they would all race for its new version.
 */
export async function behindAChange<T>(
  db: Db,
  user: TestUser,
  wikiId: string,
  requests: (() => Promise<T>)[]
): Promise<T[]> {
  const sent: Promise<T>[] = []
  await inTenant(db, user, async tx => {
    const [wiki] = await tx
      .select({ id: wikis.id })
      .from(wikis)
      .where(eq(wikis.id, wikiId))
      .for('no key update')
    if (!wiki) throw new Error('no wiki to lock')
    const [change] = await tx.execute<{ pid: number }>(
      sql`select pg_backend_pid() as pid`
    )
    if (!change) throw new Error('no backend for the change')
    for (const request of requests) {
      sent.push(request())
      await waitingBehind(db, change.pid, sent.length)
    }
  })
  return Promise.all(sent)
}

/** Delivers the account event to its route, in a transaction of its own. */
export function deliverAccountEvent(db: Db, routingKey: string, body: object) {
  const handler = accountRoutes.get(routingKey)
  if (!handler) throw new Error(`no handler for ${routingKey}`)
  const event: PlatformEvent = { routingKey, messageId: randomUUID(), body }
  return db.transaction(tx => handler(event, tx))
}

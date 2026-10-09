import { eq, sql } from 'drizzle-orm'
import { inTenant, type Db } from '../../infra/db.ts'
import type { TestUser } from '../../testing/app.ts'
import { wikis } from './schema.ts'

/** Waits until `count` transactions wait their turn, one behind the other. */
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
      select count(*)::int as count from behind`)
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

import { and, asc, eq, inArray, lte, sql } from 'drizzle-orm'
import type { Logger } from 'pino'
import type { Db, Tx } from '../infra/db.ts'
import { jobs } from './schema.ts'

/** Resolves to "keep" when the handler moved its job to run again. */
export type Handler = (payload: unknown, tx: Tx) => Promise<'keep' | undefined>

const MAX_ATTEMPTS = 10
const LAG_WARNING_MS = 60_000

export interface Job {
  kind: string
  /** A job scheduled again under the same key replaces the waiting one. */
  key?: string
  payload: unknown
  runAt: Date
}

export async function schedule(db: Db | Tx, job: Job): Promise<void> {
  const row = { ...job, payload: sql`${JSON.stringify(job.payload)}::jsonb` }
  if (job.key === undefined) {
    await db.insert(jobs).values(row)
    return
  }
  await db
    .insert(jobs)
    .values(row)
    .onConflictDoUpdate({
      target: jobs.key,
      set: { ...row, attempts: 0, lastError: null }
    })
}

export async function unschedule(db: Db | Tx, key: string): Promise<void> {
  await db.delete(jobs).where(eq(jobs.key, key))
}

// Each job runs in its own transaction, which holds the row lock until the job
// is done, so other replicas skip it. A failure rolls back the job's work and
// retries it later.
export function createScheduler(deps: {
  db: Db
  logger: Logger
  handlers: Record<string, Handler>
  now?: () => Date
}) {
  const kinds = Object.keys(deps.handlers)
  const now = deps.now ?? (() => new Date())
  const due = () => and(inArray(jobs.kind, kinds), lte(jobs.runAt, now()))

  const runOne = () =>
    deps.db.transaction(async tx => {
      const [job] = await tx
        .select()
        .from(jobs)
        .where(due())
        .orderBy(asc(jobs.runAt))
        .limit(1)
        .for('update', { skipLocked: true })
      if (!job) return false
      const handler = deps.handlers[job.kind]
      try {
        const outcome = await tx.transaction(savepoint =>
          handler ? handler(job.payload, savepoint) : Promise.resolve(undefined)
        )
        if (outcome !== 'keep') {
          await tx.delete(jobs).where(eq(jobs.id, job.id))
        }
      } catch (error) {
        const attempts = job.attempts + 1
        const message = error instanceof Error ? error.message : String(error)
        deps.logger.warn({ err: error, job: job.id, attempts }, 'job failed')
        if (attempts >= MAX_ATTEMPTS) {
          deps.logger.error({ job: job.id, kind: job.kind }, 'job dropped')
          await tx.delete(jobs).where(eq(jobs.id, job.id))
        } else {
          await tx
            .update(jobs)
            .set({
              attempts,
              lastError: message,
              runAt: sql`now() + ${`${String(30 * attempts ** 2)} seconds`}::interval`
            })
            .where(eq(jobs.id, job.id))
        }
      }
      return true
    })

  async function runDue(limit = 100): Promise<number> {
    let ran = 0
    while (ran < limit && (await runOne())) ran++
    return ran
  }

  async function warnOnLag() {
    const [oldest] = await deps.db
      .select({ runAt: jobs.runAt })
      .from(jobs)
      .where(due())
      .orderBy(asc(jobs.runAt))
      .limit(1)
    const lag = oldest ? now().getTime() - oldest.runAt.getTime() : 0
    if (lag > LAG_WARNING_MS) deps.logger.warn({ lagMs: lag }, 'jobs are late')
  }

  return {
    runDue,
    start(intervalMs: number) {
      let running = Promise.resolve()
      const timer = setInterval(() => {
        running = running
          .then(() => runDue())
          .then(warnOnLag)
          .catch((error: unknown) => {
            deps.logger.error({ err: error }, 'scheduler tick failed')
          })
      }, intervalMs)
      return async () => {
        clearInterval(timer)
        await running
      }
    }
  }
}

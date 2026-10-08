import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { pino } from 'pino'
import { afterAll, describe, expect, inject, it } from 'vitest'
import { createDb } from '../infra/db.ts'
import { createScheduler, schedule, type Handler } from './scheduler.ts'
import { jobs } from './schema.ts'

const { sql, db } = createDb(inject('databaseUrl'))
const logger = pino({ level: 'silent' })

afterAll(async () => {
  await sql.end()
})

const past = () => new Date(Date.now() - 1000)

function aKind() {
  return `test-${randomUUID()}`
}

describe('scheduler', () => {
  it('runs a due job once, and leaves a future one waiting', async () => {
    const kind = aKind()
    const ran: unknown[] = []
    const scheduler = createScheduler({
      db,
      logger,
      handlers: {
        [kind]: payload => {
          ran.push(payload)
          return Promise.resolve(undefined)
        }
      }
    })
    await schedule(db, { kind, payload: { n: 1 }, runAt: past() })
    await schedule(db, {
      kind,
      payload: { n: 2 },
      runAt: new Date(Date.now() + 60_000)
    })

    expect(await scheduler.runDue()).toBe(1)
    expect(await scheduler.runDue()).toBe(0)
    expect(ran).toEqual([{ n: 1 }])
  })

  it('runs each job once across replicas', async () => {
    const kind = aKind()
    const ran: unknown[] = []
    const handlers: Record<string, Handler> = {
      [kind]: async payload => {
        ran.push(payload)
        await new Promise(resolve => setTimeout(resolve, 5))
        return undefined
      }
    }
    for (let n = 0; n < 20; n++) {
      await schedule(db, { kind, payload: n, runAt: past() })
    }

    const replicas = [1, 2, 3].map(() =>
      createScheduler({ db, logger, handlers })
    )
    const counts = await Promise.all(replicas.map(replica => replica.runDue()))

    expect(counts.reduce((sum, count) => sum + count, 0)).toBe(20)
    expect(new Set(ran).size).toBe(20)
    expect(ran).toHaveLength(20)
  })

  it('retries a failed job later, without its partial work', async () => {
    const kind = aKind()
    const marker = aKind()
    const scheduler = createScheduler({
      db,
      logger,
      handlers: {
        [kind]: async (_payload, tx) => {
          await schedule(tx, { kind: marker, payload: null, runAt: past() })
          throw new Error('mail server down')
        }
      }
    })
    await schedule(db, { kind, payload: null, runAt: past() })

    expect(await scheduler.runDue()).toBe(1)

    const [job] = await db.select().from(jobs).where(eq(jobs.kind, kind))
    expect(job).toMatchObject({ attempts: 1, lastError: 'mail server down' })
    expect(job?.runAt.getTime()).toBeGreaterThan(Date.now())
    expect(await db.select().from(jobs).where(eq(jobs.kind, marker))).toEqual(
      []
    )
  })

  it('keeps a job its handler moved to run again', async () => {
    const kind = aKind()
    const key = randomUUID()
    const scheduler = createScheduler({
      db,
      logger,
      handlers: {
        [kind]: async (_payload, tx) => {
          await schedule(tx, {
            kind,
            key,
            payload: 2,
            runAt: new Date(Date.now() + 60_000)
          })
          return 'keep'
        }
      }
    })
    await schedule(db, { kind, key, payload: 1, runAt: past() })

    expect(await scheduler.runDue()).toBe(1)

    expect(
      await db
        .select({ payload: jobs.payload })
        .from(jobs)
        .where(eq(jobs.kind, kind))
    ).toEqual([{ payload: 2 }])
  })

  it('runs nothing while it has no handlers', async () => {
    await schedule(db, { kind: aKind(), payload: null, runAt: past() })

    expect(await createScheduler({ db, logger, handlers: {} }).runDue()).toBe(0)
  })

  it('moves a job scheduled again under the same key', async () => {
    const kind = aKind()
    const key = randomUUID()
    const later = new Date(Date.now() + 3_600_000)

    await schedule(db, { kind, key, payload: 1, runAt: past() })
    await schedule(db, { kind, key, payload: 2, runAt: later })

    expect(
      await db
        .select({ payload: jobs.payload, runAt: jobs.runAt })
        .from(jobs)
        .where(eq(jobs.kind, kind))
    ).toEqual([{ payload: 2, runAt: later }])
  })
})

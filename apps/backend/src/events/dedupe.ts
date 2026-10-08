import type { Db, Tx } from '../infra/db.ts'
import { processedEvents } from './schema.ts'

export interface EventKey {
  source: string
  id: string
}

export interface Deduplicator {
  once(key: EventKey, process: (tx: Tx) => Promise<void>): Promise<boolean>
}

export function postgresDeduplicator(db: Db, consumer: string): Deduplicator {
  return {
    once: (key, process) =>
      db.transaction(async tx => {
        const claimed = await tx
          .insert(processedEvents)
          .values({ consumer, ...key })
          .onConflictDoNothing()
          .returning({ id: processedEvents.id })
        if (claimed.length === 0) return false
        await process(tx)
        return true
      })
  }
}

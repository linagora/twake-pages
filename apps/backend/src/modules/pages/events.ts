import { sql } from 'drizzle-orm'
import type { OutgoingEvent } from '../../events/envelope.ts'
import { enqueue } from '../../events/outbox.ts'
import type { Tx } from '../../infra/db.ts'
import type { Identity } from '../auth/index.ts'

const PREVIEW_LENGTH = 280

/** The beginning of a text, cut between characters, never inside an emoji. */
export const previewOf = (text: string) =>
  Array.from(text).slice(0, PREVIEW_LENGTH).join('')

/** The page an event is about, in its wiki. */
export interface PageInWiki {
  id: string
  wikiId: string
  organizationId: string | null
  title: string
}

/**
 * Queues `com.twake.pages.page.<action>.v1` in the transaction of the change,
 * by the person who made it, as Twake Tasks queues its task events.
 */
export async function queuePageEvent(
  tx: Tx,
  identity: Identity,
  action: 'created' | 'moved' | 'published' | 'deleted',
  page: PageInWiki,
  details: Record<string, unknown>
) {
  // A UUIDv7 and the transaction's time to the microsecond, which Twake Tasks
  // writes in SQL too: Node makes neither.
  const [stamp] = await tx.execute<{ id: string; time: string }>(sql`
    select uuidv7()::text as id,
      to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as time`)
  if (!stamp) throw new Error('no event id')
  const event: OutgoingEvent = {
    specversion: '1.0',
    id: stamp.id,
    source: 'twake://pages',
    type: `com.twake.pages.page.${action}.v1`,
    time: stamp.time,
    twakeorg: page.organizationId ?? undefined,
    twakeactorid: identity.userId,
    twakeactor: identity.email,
    data: {
      object: {
        type: 'page',
        id: page.id,
        title: page.title,
        container: { kind: 'wiki', id: page.wikiId }
      },
      ...details
    }
  }
  await enqueue(tx, event)
}

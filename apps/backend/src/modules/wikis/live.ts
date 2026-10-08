import { and, eq, isNull, sql } from 'drizzle-orm'
import type { Tx } from '../../infra/db.ts'
import { Refused } from '../../infra/refusals.ts'
import { wikis } from './schema.ts'

// Sent by the wikis_notify_change trigger.
export const WIKI_CHANNEL = 'wiki_changes'

/**
 * Moves the wiki's version in the transaction of a change to it, so the
 * people who show it reload it. Called before reading what the change depends
 * on, since its row lock makes concurrent changes to the wiki wait their turn.
 */
export async function bumpWiki(tx: Tx, wikiId: string) {
  const [wiki] = await tx
    .update(wikis)
    .set({ version: sql`${wikis.version} + 1` })
    .where(and(eq(wikis.id, wikiId), isNull(wikis.deletedAt)))
    .returning({ kind: wikis.kind })
  if (!wiki) throw new Refused('not_found')
  return wiki
}

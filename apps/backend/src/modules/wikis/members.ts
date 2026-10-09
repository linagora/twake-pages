import { and, eq, inArray, sql } from 'drizzle-orm'
import type { Tx } from '../../infra/db.ts'
import { wikiMembers } from './schema.ts'

/**
 * Takes the people out of the wiki: removed by its admin, leaving it, or out
 * of its space. Gives those who were members.
 *
 * Their favorites and visits of its pages go with them, while what they wrote,
 * their follows and their notifications stay, out of their lists until they
 * are members again. Unlike Twake Tasks, which unfollows the project's tasks
 * of a member who leaves, the follows stay for when they come back.
 */
export async function takeOutOfWiki(
  tx: Tx,
  wikiId: string,
  userIds: string[]
): Promise<string[]> {
  // The person may be the one acting, who in B2C sees the wiki's pages
  // through their membership, so their rows go first.
  for (const userId of userIds) {
    await tx.execute(
      sql`select app_leave_wiki(${wikiId}::uuid, ${userId}::uuid)`
    )
  }
  const left = await tx
    .delete(wikiMembers)
    .where(
      and(eq(wikiMembers.wikiId, wikiId), inArray(wikiMembers.userId, userIds))
    )
    .returning({ userId: wikiMembers.userId })
  return left.map(member => member.userId)
}

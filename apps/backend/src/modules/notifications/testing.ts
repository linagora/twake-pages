import { inTenant, type Db } from '../../infra/db.ts'
import type { TestUser, WikiSummary } from '../../testing/app.ts'
import { notifications } from './schema.ts'

/**
 * Tells the person of a version the actor published of the wiki's home page,
 * as publishing will notify its followers.
 */
export function notify(
  db: Db,
  actor: TestUser,
  wiki: WikiSummary,
  user: TestUser,
  readAt: Date | null = null
) {
  return inTenant(db, actor, tx =>
    tx.insert(notifications).values({
      pageId: wiki.homePageId,
      wikiId: wiki.id,
      organizationId: actor.organizationId,
      userId: user.userId,
      reason: 'published',
      actorId: actor.userId,
      actorEmail: actor.email,
      version: 2,
      readAt
    })
  )
}

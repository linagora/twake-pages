import { inTenant, type Db } from '../../infra/db.ts'
import type { TestUser, WikiSummary } from '../../testing/app.ts'
import { notifications } from './schema.ts'

/** The notification of a version the actor published of the wiki's home page. */
const versionNotification = (
  actor: TestUser,
  wiki: WikiSummary,
  user: TestUser,
  version: number,
  readAt: Date | null = null
) => ({
  pageId: wiki.homePageId,
  wikiId: wiki.id,
  organizationId: actor.organizationId,
  userId: user.userId,
  reason: 'published' as const,
  actorId: actor.userId,
  actorEmail: actor.email,
  actorName: actor.name ?? null,
  version,
  readAt
})

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
    tx
      .insert(notifications)
      .values(versionNotification(actor, wiki, user, 2, readAt))
  )
}

/**
 * Tells the person of `count` versions the actor published of the wiki's
 * home page, from version 2 on. They are written at once: one after the
 * other, through publishing, a hundred outlast a test's time on a busy
 * machine.
 */
export function notifyOfVersions(
  db: Db,
  actor: TestUser,
  wiki: WikiSummary,
  user: TestUser,
  count: number
) {
  return inTenant(db, actor, tx =>
    tx
      .insert(notifications)
      .values(
        Array.from({ length: count }, (_, index) =>
          versionNotification(actor, wiki, user, index + 2)
        )
      )
  )
}

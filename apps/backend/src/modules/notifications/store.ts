import { count, desc, eq, isNull } from 'drizzle-orm'
import { inTenant, type Db, type Tx } from '../../infra/db.ts'
import type { Identity } from '../auth/index.ts'
import { pages } from '../pages/schema.ts'
import { accessibleWikis } from '../wikis/access.ts'
import { wikis } from '../wikis/schema.ts'
import { notifications } from './schema.ts'

const LISTED_NOTIFICATIONS = 100

/**
 * The person's notifications about the pages of the wikis they can open, in
 * the trash or not: those of a wiki they left wait for them to be back. The
 * list, the unread counts and the badges all count these.
 */
export function seenNotifications(tx: Tx, userId: string) {
  const accessible = accessibleWikis(tx, userId)
  return tx
    .select({
      id: notifications.id,
      pageId: notifications.pageId,
      wikiId: notifications.wikiId,
      reason: notifications.reason,
      actorId: notifications.actorId,
      actorEmail: notifications.actorEmail,
      actorName: notifications.actorName,
      version: notifications.version,
      commentId: notifications.commentId,
      createdAt: notifications.createdAt,
      readAt: notifications.readAt
    })
    .from(notifications)
    .innerJoin(accessible, eq(accessible.wikiId, notifications.wikiId))
    .where(eq(notifications.userId, userId))
    .as('seen')
}

export function createNotificationStore(db: Db) {
  return {
    /**
     * The person's newest notifications, about their pages as titled now,
     * and how many of all they see are unread.
     */
    notifications(identity: Identity) {
      return inTenant(db, identity, async tx => {
        const seen = seenNotifications(tx, identity.userId)
        const listed = await tx
          .select({
            id: seen.id,
            reason: seen.reason,
            page: { id: pages.id, title: pages.title },
            wiki: { id: wikis.id, name: wikis.name, kind: wikis.kind },
            actor: {
              id: seen.actorId,
              email: seen.actorEmail,
              name: seen.actorName
            },
            version: seen.version,
            commentId: seen.commentId,
            createdAt: seen.createdAt,
            readAt: seen.readAt
          })
          .from(seen)
          .innerJoin(pages, eq(pages.id, seen.pageId))
          .innerJoin(wikis, eq(wikis.id, seen.wikiId))
          .orderBy(desc(seen.createdAt), desc(seen.id))
          .limit(LISTED_NOTIFICATIONS)
        const [unread] = await tx
          .select({ count: count() })
          .from(seen)
          .where(isNull(seen.readAt))
        return { notifications: listed, unread: unread?.count ?? 0 }
      })
    }
  }
}

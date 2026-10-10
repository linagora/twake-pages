import { and, count, desc, eq, isNull, ne, notInArray } from 'drizzle-orm'
import { inTenant, type Db, type Tx } from '../../infra/db.ts'
import type { Identity } from '../auth/index.ts'
import { pages } from '../pages/schema.ts'
import { accessibleWikis } from '../wikis/access.ts'
import { wikiMembers, wikis } from '../wikis/schema.ts'
import {
  notifications,
  pageFollowers,
  type NOTIFICATION_REASONS
} from './schema.ts'

const LISTED_NOTIFICATIONS = 100

type NotificationReason = (typeof NOTIFICATION_REASONS)[number]

/** The page a notification is about, as `tellFollowers` needs it. */
interface NotifiedPage {
  id: string
  wikiId: string
  organizationId: string | null
}

/**
 * Tells the page's followers a change of it, one notification each, in the
 * transaction that made it, as Twake Tasks writes its rows from triggers.
 * The actor is never told, and neither is a follower who left the wiki: an
 * insert without `returning`, whose rows the restrictive `own_select` would
 * hide from the actor.
 *
 * `reason` is `published` for a new version, and `commented` for a comment,
 * whose followers the members it mentions are told instead of: they are left
 * out by who they are, not by the order of the writes, since the store has
 * already made them follow by now.
 */
export async function tellFollowers(
  tx: Tx,
  page: NotifiedPage,
  actor: Identity,
  reason: NotificationReason,
  fields: { version?: number; commentId?: string } = {},
  excluded: readonly string[] = []
): Promise<void> {
  const followers = await tx
    .select({ userId: pageFollowers.userId })
    .from(pageFollowers)
    .innerJoin(
      wikiMembers,
      and(
        eq(wikiMembers.wikiId, page.wikiId),
        eq(wikiMembers.userId, pageFollowers.userId)
      )
    )
    .where(
      and(
        eq(pageFollowers.pageId, page.id),
        ne(pageFollowers.userId, actor.userId),
        ...(excluded.length > 0
          ? [notInArray(pageFollowers.userId, [...excluded])]
          : [])
      )
    )
  if (followers.length === 0) return
  await tx.insert(notifications).values(
    followers.map(({ userId }) => ({
      pageId: page.id,
      wikiId: page.wikiId,
      organizationId: page.organizationId,
      userId,
      reason,
      actorId: actor.userId,
      actorEmail: actor.email,
      actorName: actor.name,
      version: fields.version ?? null,
      commentId: fields.commentId ?? null
    }))
  )
}

/**
 * Tells the members a comment mentions, one `mentioned` notification each,
 * for the members a new comment mentions or those an edit mentions anew. The
 * members are the wiki's current members, as `membersMentioned` finds them;
 * the actor, who mentions themself, is left out, as everywhere.
 */
export async function tellMentioned(
  tx: Tx,
  page: NotifiedPage,
  actor: Identity,
  commentId: string,
  members: readonly { userId: string }[]
): Promise<void> {
  const recipients = members.filter(member => member.userId !== actor.userId)
  if (recipients.length === 0) return
  const reason: NotificationReason = 'mentioned'
  await tx.insert(notifications).values(
    recipients.map(({ userId }) => ({
      pageId: page.id,
      wikiId: page.wikiId,
      organizationId: page.organizationId,
      userId,
      reason,
      actorId: actor.userId,
      actorEmail: actor.email,
      actorName: actor.name,
      commentId
    }))
  )
}

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

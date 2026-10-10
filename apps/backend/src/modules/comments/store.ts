import { and, asc, eq, isNull, sql } from 'drizzle-orm'
import { inTenant, type Db, type Tx } from '../../infra/db.ts'
import { Refused, writeOrRefuse } from '../../infra/refusals.ts'
import type { Identity } from '../auth/index.ts'
import { previewOf, queuePageEvent } from '../pages/events.ts'
import { pages } from '../pages/schema.ts'
import { follow, pageInReach, pageToChange } from '../pages/store.ts'
import { tellFollowers, tellMentioned } from '../notifications/store.ts'
import { checkRole } from '../wikis/access.ts'
import { bumpWiki } from '../wikis/live.ts'
import { membersMentioned } from './mentions.ts'
import { comments } from './schema.ts'

/**
 * The contract's Comment, its author named by the email and name it keeps,
 * which stay when the author leaves the wiki, as a version's do. Twake Tasks
 * keeps only the email, and names the authors still members as they look
 * now.
 */
function commentOf(row: typeof comments.$inferSelect) {
  return {
    id: row.id,
    parentId: row.parentId,
    author: { id: row.authorId, email: row.authorEmail, name: row.authorName },
    body: row.body,
    createdAt: row.createdAt,
    editedAt: row.editedAt
  }
}

/**
 * The live page the person comments on, behind its wiki's row lock, read as
 * pageToPublish reads the page to publish, but for a member of any role:
 * `not_found` out of their reach, `in_trash` in the trash.
 */
async function pageToComment(tx: Tx, identity: Identity, pageId: string) {
  const page = await pageToChange(tx, identity, pageId, 'viewer')
  if (page.deletedAt) throw new Refused('in_trash')
  return page
}

// Replies are one level deep, under a comment of their own page.
async function checkParentComment(tx: Tx, pageId: string, parentId: string) {
  const [parent] = await tx
    .select({ id: comments.id })
    .from(comments)
    .where(
      and(
        eq(comments.id, parentId),
        eq(comments.pageId, pageId),
        isNull(comments.parentId)
      )
    )
  if (!parent) throw new Refused('invalid_request')
}

/** The comment, with the page it is written on. */
function commentWithPage(tx: Tx, commentId: string) {
  return tx
    .select({
      comment: comments,
      page: {
        id: pages.id,
        wikiId: pages.wikiId,
        organizationId: pages.organizationId,
        deletedAt: pages.deletedAt
      }
    })
    .from(comments)
    .innerJoin(pages, eq(pages.id, comments.pageId))
    .where(eq(comments.id, commentId))
}

/**
 * The comment the person changes, behind its wiki's row lock, refused in the
 * order api.md writes: `not_found` out of their reach, `forbidden` to anyone
 * but its author, and an admin when `byAdmin`, then `not_found` once
 * deleted, and `in_trash` on a page in the trash. It takes the lock as
 * pageToChange does, but reads the comment, which names its page, and
 * refuses whoever may not change it before the lock, by the role checkRole
 * answers, which pageToChange keeps to itself.
 */
async function commentToChange(
  tx: Tx,
  identity: Identity,
  commentId: string,
  { byAdmin = false } = {}
) {
  const [found] = await commentWithPage(tx, commentId)
  if (!found) throw new Refused('not_found')
  const role = await checkRole(tx, identity, found.page.wikiId, 'viewer')
  const byAuthor = found.comment.authorId === identity.userId
  if (!byAuthor && !(byAdmin && role === 'admin')) {
    throw new Refused('forbidden')
  }
  await bumpWiki(tx, found.page.wikiId)
  // Read after the lock, which every change to the wiki's pages takes.
  const [current] = await commentWithPage(tx, commentId)
  if (!current) throw new Refused('not_found')
  if (current.page.deletedAt) throw new Refused('in_trash')
  return current
}

export interface NewComment {
  body: string
  /** The comment it answers, none when null or left out. */
  parentId?: string | null | undefined
}

export function createCommentStore(db: Db) {
  return {
    /**
     * The page's comments, oldest first, replies among them, or null for a
     * page out of the person's reach. A page in the trash is in reach, as it
     * opens from there.
     */
    listComments(identity: Identity, pageId: string) {
      return inTenant(db, identity, async tx => {
        if (!(await pageInReach(tx, identity, pageId))) return null
        const rows = await tx
          .select()
          .from(comments)
          .where(eq(comments.pageId, pageId))
          .orderBy(asc(comments.createdAt), asc(comments.id))
        return rows.map(commentOf)
      })
    },

    /**
     * A comment by the person, who then follows the page, as do the members
     * it mentions, and its event, queued with them as its recipients.
     */
    addComment(identity: Identity, pageId: string, input: NewComment) {
      return writeOrRefuse(db, identity, async tx => {
        const page = await pageToComment(tx, identity, pageId)
        const parentId = input.parentId ?? null
        if (parentId !== null) await checkParentComment(tx, pageId, parentId)
        const [added] = await tx
          .insert(comments)
          .values({
            pageId,
            parentId,
            organizationId: page.organizationId,
            authorId: identity.userId,
            authorEmail: identity.email,
            authorName: identity.name,
            body: input.body
          })
          .returning()
        if (!added) throw new Error('comment insert returned nothing')
        await follow(tx, page, identity.userId)
        const mentioned = await membersMentioned(tx, page.wikiId, input.body)
        for (const member of mentioned) await follow(tx, page, member.userId)
        // As Twake Tasks tells them from its trigger: the members it mentions
        // are told `mentioned`, and the page's other followers `commented`,
        // never the actor. The store has already made the members it mentions
        // follow, so they are kept out of `commented` by who they are.
        await tellMentioned(tx, page, identity, added.id, mentioned)
        await tellFollowers(
          tx,
          page,
          identity,
          'commented',
          { commentId: added.id },
          mentioned.map(member => member.userId)
        )
        // As Twake Tasks names the recipients of an assignment: by the email
        // of their membership, the person who acted among them, the key left
        // out when there are none.
        const recipients = mentioned.map(member => ({
          uuid: member.userId,
          email: member.email,
          reason: 'mentioned'
        }))
        await queuePageEvent(tx, identity, 'commented', page, {
          commentId: added.id,
          preview: previewOf(added.body),
          ...(recipients.length > 0 ? { recipients } : {})
        })
        return commentOf(added)
      })
    },

    /**
     * The person's comment with a new body. The members it mentions anew
     * follow the page, its author too when the edit is the first to mention
     * them; those it mentioned already, and its author otherwise, chose
     * whether to follow once it was written.
     */
    editComment(identity: Identity, commentId: string, body: string) {
      return writeOrRefuse(db, identity, async tx => {
        const { comment, page } = await commentToChange(tx, identity, commentId)
        const [edited] = await tx
          .update(comments)
          .set({ body, editedAt: sql`now()` })
          .where(eq(comments.id, commentId))
          .returning()
        if (!edited) throw new Error('comment update returned nothing')
        const mentioned = await membersMentioned(
          tx,
          page.wikiId,
          body,
          comment.body
        )
        for (const member of mentioned) await follow(tx, page, member.userId)
        // An edit is no new comment: only the members it mentions anew are
        // told, and the page's other followers are told nothing.
        await tellMentioned(tx, page, identity, commentId, mentioned)
        return commentOf(edited)
      })
    },

    /**
     * Deletes the comment with its replies, which its parent key takes. Twake
     * Tasks keeps every comment as written, where a wiki's stay with its page
     * as long as it lives: their author mends or deletes them, and an admin
     * deletes what the wiki should not keep, though only the author edits a
     * comment, whose words stay theirs.
     */
    deleteComment(identity: Identity, commentId: string) {
      return writeOrRefuse(db, identity, async tx => {
        await commentToChange(tx, identity, commentId, { byAdmin: true })
        await tx.delete(comments).where(eq(comments.id, commentId))
      })
    }
  }
}

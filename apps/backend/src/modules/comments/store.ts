import { and, asc, eq, isNull } from 'drizzle-orm'
import { inTenant, type Db, type Tx } from '../../infra/db.ts'
import { Refused, writeOrRefuse } from '../../infra/refusals.ts'
import type { Identity } from '../auth/index.ts'
import { follow, pageInReach, pageToChange } from '../pages/store.ts'
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
     * it mentions.
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
        return commentOf(added)
      })
    }
  }
}

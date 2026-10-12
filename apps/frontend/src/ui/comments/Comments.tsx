import { Icon, Pen, Reply, Trash } from '@linagora/twake-icons'
import { Button, Typography } from '@linagora/twake-mui'
import {
  Fragment,
  useId,
  useMemo,
  useState,
  type ReactElement,
  type ReactNode
} from 'react'

import { ListSkeleton } from '@/ds/EmptyState'
import { Mention } from '@/ds/Mention'
import { PlainText } from '@/ds/PlainText'
import { Feed, FeedItem } from '@/ds/SidePanel'
import { commentParts, type Comment } from '@/domain/comment'
import type { Page } from '@/domain/page'
import { displayName, sameEmail } from '@/domain/person'
import {
  EditCommentForm,
  NewCommentForm,
  ReplyForm
} from '@/ui/comments/CommentForm'
import { DeleteCommentDialog } from '@/ui/comments/DeleteCommentDialog'
import { useI18n } from '@/ui/i18n/useI18n'
import { PersonAvatar } from '@/ui/people/PersonAvatar'
import { useSession } from '@/ui/session/SessionGate'
import { localTime } from '@/ui/settings/zone'
import { useComments, useSharing, useWiki } from '@/ui/wiki/queries'

/**
 * The comments of a page, below its content, where Twake Tasks shows a
 * task's in its panel. A page in the trash takes no new one.
 */
export function Comments({ page }: { page: Page }): ReactElement {
  const { t } = useI18n()
  const titleId = useId()

  return (
    <section aria-labelledby={titleId} className="u-mt-2">
      <Typography
        id={titleId}
        variant="subtitle1"
        component="h2"
        className="u-fw-bold u-mb-1"
      >
        {t('comments.title')}
      </Typography>
      {/* Keyed on the page being writable: a page sent to the trash hides the
          reply, edit and delete states without closing them, so a fresh feed
          as it goes keeps them from opening again once it comes back from the
          trash. */}
      <CommentFeed
        key={page.deletedAt === null ? 'live' : 'trashed'}
        page={page}
      />
      {page.deletedAt === null && <NewCommentForm page={page} />}
    </section>
  )
}

/**
 * Oldest first, as the backend lists them, each reply under the comment it
 * answers, where Twake Tasks has no replies. A reply answers a comment, never
 * a reply, and is written to one comment at a time.
 */
function CommentFeed({ page }: { page: Page }): ReactElement {
  const { t } = useI18n()
  const comments = useComments(page.wikiId, page.id)
  const [replyingTo, setReplyingTo] = useState<string | null>(null)
  const names = useMemberNames(page.wikiId)

  if (comments.isError) {
    return <Typography role="alert">{t('comments.loadFailed')}</Typography>
  }
  if (!comments.data) return <ListSkeleton label={t('app.loading')} rows={2} />
  const all = comments.data
  const writable = page.deletedAt === null
  const closeReply = () => {
    setReplyingTo(null)
  }
  return (
    <Feed label={t('comments.title')}>
      {all
        .filter(comment => comment.parentId === null)
        .map(comment => {
          const replies = all.filter(reply => reply.parentId === comment.id)
          return (
            <CommentItem
              key={comment.id}
              page={page}
              comment={comment}
              names={names}
              onReply={
                writable
                  ? () => {
                      setReplyingTo(comment.id)
                    }
                  : null
              }
            >
              {replies.length > 0 && (
                <div className="u-mt-1">
                  <Feed label={t('comments.replies')}>
                    {replies.map(reply => (
                      <CommentItem
                        key={reply.id}
                        page={page}
                        comment={reply}
                        names={names}
                        onReply={null}
                      />
                    ))}
                  </Feed>
                </div>
              )}
              {writable && replyingTo === comment.id && (
                <ReplyForm page={page} to={comment} onClose={closeReply} />
              )}
            </CommentItem>
          )
        })}
    </Feed>
  )
}

/**
 * The name of each member of the wiki, by their email lowercased, as Twake
 * Tasks names the people its comments mention. An invitee is no member yet,
 * and the backend reads no mention of them.
 */
function useMemberNames(wikiId: string): ReadonlyMap<string, string> {
  const members = useSharing(wikiId).data?.members
  return useMemo(
    () =>
      new Map(
        members?.map(
          member => [member.email.toLowerCase(), displayName(member)] as const
        )
      ),
    [members]
  )
}

/**
 * A comment under its author's name and the time it was written. Its author
 * edits it in place and deletes it, and an admin of the wiki deletes anyone's,
 * as the backend lets them, though Twake Tasks keeps a comment as written.
 * The author is told by their email, as the session has no id. A page in the
 * trash refuses both.
 */
function CommentItem({
  page,
  comment,
  names,
  onReply,
  children
}: {
  page: Page
  comment: Comment
  /** The name of each member, by their email lowercased. */
  names: ReadonlyMap<string, string>
  /** Opens a reply to the comment, or null when it takes none. */
  onReply: (() => void) | null
  children?: ReactNode
}): ReactElement {
  const { t, lang } = useI18n()
  const { user } = useSession()
  const role = useWiki(page.wikiId).data?.role
  const [editing, setEditing] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const author = displayName(comment.author)
  const writable = page.deletedAt === null
  const mine = sameEmail(comment.author.email, user.email)
  const editable = writable && mine
  const deletable = writable && (mine || role === 'admin')

  return (
    <FeedItem
      avatar={
        <PersonAvatar
          email={comment.author.email}
          name={comment.author.name}
          size={28}
        />
      }
    >
      <article aria-label={author}>
        <Typography variant="body2" component="div">
          <strong>{author}</strong>
          <Typography component="span" variant="caption" color="textSecondary">
            {` · ${localTime(comment.createdAt, lang)}`}
            {comment.editedAt !== null && ` · ${t('comments.edited')}`}
          </Typography>
        </Typography>
        {editable && editing ? (
          <EditCommentForm
            page={page}
            comment={comment}
            onClose={() => {
              setEditing(false)
            }}
          />
        ) : (
          <>
            <CommentBody body={comment.body} names={names} />
            {(onReply !== null || editable || deletable) && (
              <div className="u-mt-half">
                {onReply && (
                  <Button
                    variant="text"
                    size="small"
                    startIcon={<Icon icon={Reply} />}
                    onClick={onReply}
                  >
                    {t('comments.reply')}
                  </Button>
                )}
                {editable && (
                  <Button
                    variant="text"
                    size="small"
                    startIcon={<Icon icon={Pen} />}
                    onClick={() => {
                      setEditing(true)
                    }}
                  >
                    {t('comments.edit')}
                  </Button>
                )}
                {deletable && (
                  <Button
                    variant="text"
                    size="small"
                    startIcon={<Icon icon={Trash} />}
                    onClick={() => {
                      setDeleting(true)
                    }}
                  >
                    {t('comments.delete')}
                  </Button>
                )}
              </div>
            )}
          </>
        )}
        {deletable && deleting && (
          <DeleteCommentDialog
            page={page}
            comment={comment}
            onClose={() => {
              setDeleting(false)
            }}
          />
        )}
      </article>
      {children}
    </FeedItem>
  )
}

/**
 * The text of a comment, read as the backend reads its mentions: a member's
 * shows by their name, and any other email as it was typed, as in Twake
 * Tasks.
 */
function CommentBody({
  body,
  names
}: {
  body: string
  names: ReadonlyMap<string, string>
}): ReactElement {
  return (
    <PlainText>
      {commentParts(body).map((part, index) => {
        if ('text' in part) return <Fragment key={index}>{part.text}</Fragment>
        const name = names.get(part.mention.toLowerCase())
        return name === undefined ? (
          <Fragment key={index}>{`@${part.mention}`}</Fragment>
        ) : (
          <Mention key={index} name={name} email={part.mention} />
        )
      })}
    </PlainText>
  )
}

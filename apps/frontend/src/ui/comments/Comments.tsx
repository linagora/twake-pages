import { Icon, Pen, Reply } from '@linagora/twake-icons'
import { Button, Typography } from '@linagora/twake-mui'
import { useId, useState, type ReactElement, type ReactNode } from 'react'

import { ListSkeleton } from '@/ds/EmptyState'
import { PlainText } from '@/ds/PlainText'
import { Feed, FeedItem } from '@/ds/SidePanel'
import type { Comment } from '@/domain/comment'
import type { Page } from '@/domain/page'
import { displayName, sameEmail } from '@/domain/person'
import {
  EditCommentForm,
  NewCommentForm,
  ReplyForm
} from '@/ui/comments/CommentForm'
import { useI18n } from '@/ui/i18n/useI18n'
import { PersonAvatar } from '@/ui/people/PersonAvatar'
import { useSession } from '@/ui/session/SessionGate'
import { localTime } from '@/ui/settings/zone'
import { useComments } from '@/ui/wiki/queries'

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
      <CommentFeed page={page} />
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
 * A comment under its author's name and the time it was written. Its author,
 * told by their email as the session has no id, edits it in place, but not
 * on a page in the trash.
 */
function CommentItem({
  page,
  comment,
  onReply,
  children
}: {
  page: Page
  comment: Comment
  /** Opens a reply to the comment, or null when it takes none. */
  onReply: (() => void) | null
  children?: ReactNode
}): ReactElement {
  const { t, lang } = useI18n()
  const { user } = useSession()
  const [editing, setEditing] = useState(false)
  const author = displayName(comment.author)
  const editable =
    page.deletedAt === null && sameEmail(comment.author.email, user.email)

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
            <PlainText>{comment.body}</PlainText>
            {(onReply !== null || editable) && (
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
              </div>
            )}
          </>
        )}
      </article>
      {children}
    </FeedItem>
  )
}

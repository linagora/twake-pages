import { Typography } from '@linagora/twake-mui'
import { useId, type ReactElement, type ReactNode } from 'react'

import { ListSkeleton } from '@/ds/EmptyState'
import { PlainText } from '@/ds/PlainText'
import { Feed, FeedItem } from '@/ds/SidePanel'
import type { Comment } from '@/domain/comment'
import type { Page } from '@/domain/page'
import { displayName } from '@/domain/person'
import { CommentForm } from '@/ui/comments/CommentForm'
import { useI18n } from '@/ui/i18n/useI18n'
import { PersonAvatar } from '@/ui/people/PersonAvatar'
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
      {page.deletedAt === null && <CommentForm page={page} />}
    </section>
  )
}

/**
 * Oldest first, as the backend lists them, each reply under the comment it
 * answers, where Twake Tasks has no replies.
 */
function CommentFeed({ page }: { page: Page }): ReactElement {
  const { t } = useI18n()
  const comments = useComments(page.wikiId, page.id)

  if (comments.isError) {
    return <Typography role="alert">{t('comments.loadFailed')}</Typography>
  }
  if (!comments.data) return <ListSkeleton label={t('app.loading')} rows={2} />
  const all = comments.data
  return (
    <Feed label={t('comments.title')}>
      {all
        .filter(comment => comment.parentId === null)
        .map(comment => {
          const replies = all.filter(reply => reply.parentId === comment.id)
          return (
            <CommentItem key={comment.id} comment={comment}>
              {replies.length > 0 && (
                <div className="u-mt-1">
                  <Feed label={t('comments.replies')}>
                    {replies.map(reply => (
                      <CommentItem key={reply.id} comment={reply} />
                    ))}
                  </Feed>
                </div>
              )}
            </CommentItem>
          )
        })}
    </Feed>
  )
}

/** A comment under its author's name and the time it was written. */
function CommentItem({
  comment,
  children
}: {
  comment: Comment
  children?: ReactNode
}): ReactElement {
  const { t, lang } = useI18n()
  const author = displayName(comment.author)

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
        <PlainText>{comment.body}</PlainText>
      </article>
      {children}
    </FeedItem>
  )
}

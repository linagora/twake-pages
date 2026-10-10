import type { ReactElement } from 'react'

import { ConfirmDialog } from '@/ds/ConfirmDialog'
import type { Comment } from '@/domain/comment'
import type { Page } from '@/domain/page'
import { useI18n } from '@/ui/i18n/useI18n'
import { useComments, useDeleteComment } from '@/ui/wiki/queries'

/**
 * Asks before a comment is deleted, and says when its replies go with it, as
 * the backend deletes them too. Twake Tasks has no such dialog: it keeps a
 * comment as written.
 */
export function DeleteCommentDialog({
  page,
  comment,
  onClose
}: {
  page: Page
  comment: Comment
  onClose: () => void
}): ReactElement {
  const { t } = useI18n()
  const comments = useComments(page.wikiId, page.id)
  const remove = useDeleteComment(page, comment.id)
  const answered =
    comments.data?.some(each => each.parentId === comment.id) ?? false

  return (
    <ConfirmDialog
      title={t('deleteComment.title')}
      text={t(answered ? 'deleteComment.withReplies' : 'deleteComment.text')}
      confirm={t('deleteComment.confirm')}
      cancel={t('deleteComment.cancel')}
      failed={remove.isError ? t('deleteComment.failed') : null}
      pending={remove.isPending}
      onConfirm={() => {
        remove.mutate(undefined, { onSuccess: onClose })
      }}
      onClose={onClose}
    />
  )
}

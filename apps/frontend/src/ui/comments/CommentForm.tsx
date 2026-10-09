import { Button, TextField, Typography } from '@linagora/twake-mui'
import { useState, type ReactElement } from 'react'

import type { Comment } from '@/domain/comment'
import type { Page } from '@/domain/page'
import { displayName } from '@/domain/person'
import { focusOnMount } from '@/ui/focusOnMount'
import { useI18n } from '@/ui/i18n/useI18n'
import { useAddComment } from '@/ui/wiki/queries'

// What the backend takes of a comment, once trimmed.
const MAX_COMMENT = 10_000

/**
 * A new comment or a reply, in plain text as the backend keeps it, where
 * Twake Tasks writes Markdown in TipTap. Ctrl+Enter sends it, as in Twake
 * Tasks. The form of a reply takes the focus as it opens, and closes once
 * the reply is sent.
 */
export function CommentForm({
  page,
  reply
}: {
  page: Page
  /** The comment a reply answers, and what closes its form. */
  reply?: { to: Comment; onClose: () => void }
}): ReactElement {
  const { t } = useI18n()
  const add = useAddComment(page)
  const [body, setBody] = useState('')
  const text = body.trim()
  const sendable = !add.isPending && text !== '' && text.length <= MAX_COMMENT
  const send = () => {
    if (!sendable) return
    add.mutate(reply ? { body: text, parentId: reply.to.id } : { body: text }, {
      onSuccess: () => {
        setBody('')
        reply?.onClose()
      }
    })
  }

  return (
    <form
      className="u-mt-1"
      aria-label={
        reply && t('comments.replyTo', { name: displayName(reply.to.author) })
      }
      onSubmit={event => {
        event.preventDefault()
        send()
      }}
    >
      <TextField
        label={t(reply ? 'comments.replyLabel' : 'comments.comment')}
        placeholder={t(
          reply ? 'comments.replyPlaceholder' : 'comments.placeholder'
        )}
        inputRef={reply && focusOnMount}
        value={body}
        onChange={event => {
          setBody(event.target.value)
        }}
        onKeyDown={event => {
          if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
            event.preventDefault()
            send()
          }
        }}
        multiline
        minRows={2}
        fullWidth
        size="small"
      />
      <div className="u-flex u-flex-items-center u-mt-half">
        <Typography
          variant="caption"
          color="textSecondary"
          className="u-mr-auto"
        >
          {t('comments.sendHint')}
        </Typography>
        {reply && (
          <Button variant="text" size="small" onClick={reply.onClose}>
            {t('comments.cancel')}
          </Button>
        )}
        <Button type="submit" size="small" disabled={!sendable}>
          {t('comments.send')}
        </Button>
      </div>
      {add.isError && (
        <Typography role="alert" variant="caption" color="error">
          {t('comments.sendFailed')}
        </Typography>
      )}
    </form>
  )
}

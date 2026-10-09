import { Button, TextField, Typography } from '@linagora/twake-mui'
import { useState, type ReactElement } from 'react'

import type { Page } from '@/domain/page'
import { useI18n } from '@/ui/i18n/useI18n'
import { useAddComment } from '@/ui/wiki/queries'

// What the backend takes of a comment, once trimmed.
const MAX_COMMENT = 10_000

/**
 * A new comment, in plain text as the backend keeps it, where Twake Tasks
 * writes Markdown in TipTap. Ctrl+Enter sends it, as in Twake Tasks.
 */
export function CommentForm({ page }: { page: Page }): ReactElement {
  const { t } = useI18n()
  const add = useAddComment(page)
  const [body, setBody] = useState('')
  const text = body.trim()
  const sendable = !add.isPending && text !== '' && text.length <= MAX_COMMENT
  const send = () => {
    if (!sendable) return
    add.mutate(
      { body: text },
      {
        onSuccess: () => {
          setBody('')
        }
      }
    )
  }

  return (
    <form
      className="u-mt-1"
      onSubmit={event => {
        event.preventDefault()
        send()
      }}
    >
      <TextField
        label={t('comments.comment')}
        placeholder={t('comments.placeholder')}
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

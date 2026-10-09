import { Button, TextField, Typography } from '@linagora/twake-mui'
import type { UseMutationResult } from '@tanstack/react-query'
import { useState, type ReactElement } from 'react'

import type { Comment } from '@/domain/comment'
import type { Page } from '@/domain/page'
import { displayName } from '@/domain/person'
import { focusOnMount } from '@/ui/focusOnMount'
import { useI18n, type TranslationKey } from '@/ui/i18n/useI18n'
import { useAddComment, useEditComment } from '@/ui/wiki/queries'

// What the backend takes of a comment, once trimmed.
const MAX_COMMENT = 10_000

// The fields of a reply and of an edit are named apart from the new
// comment's, which the page shows with them.
const FORM_WORDS = {
  comment: {
    label: 'comments.comment',
    placeholder: 'comments.placeholder',
    hint: 'comments.sendHint',
    submit: 'comments.send',
    failed: 'comments.sendFailed'
  },
  reply: {
    label: 'comments.replyLabel',
    placeholder: 'comments.replyPlaceholder',
    hint: 'comments.sendHint',
    submit: 'comments.send',
    failed: 'comments.sendFailed'
  },
  edit: {
    label: 'comments.editLabel',
    placeholder: 'comments.placeholder',
    hint: 'comments.saveHint',
    submit: 'comments.save',
    failed: 'comments.saveFailed'
  }
} as const satisfies Record<string, Record<string, TranslationKey>>

export function NewCommentForm({ page }: { page: Page }): ReactElement {
  const add = useAddComment(page, null)
  return <CommentForm kind="comment" change={add} />
}

export function ReplyForm({
  page,
  to,
  onClose
}: {
  page: Page
  to: Comment
  onClose: () => void
}): ReactElement {
  const { t } = useI18n()
  const add = useAddComment(page, to.id)
  return (
    <CommentForm
      kind="reply"
      change={add}
      name={t('comments.replyTo', { name: displayName(to.author) })}
      onClose={onClose}
    />
  )
}

export function EditCommentForm({
  page,
  comment,
  onClose
}: {
  page: Page
  comment: Comment
  onClose: () => void
}): ReactElement {
  const edit = useEditComment(page, comment.id)
  return (
    <CommentForm
      kind="edit"
      change={edit}
      initial={comment.body}
      onClose={onClose}
    />
  )
}

/**
 * The text of a comment, in plain text as the backend keeps it, where Twake
 * Tasks writes Markdown in TipTap. Ctrl+Enter sends it, as in Twake Tasks. A
 * form opened from a comment takes the focus as it opens, and closes once
 * its text is sent.
 */
function CommentForm({
  kind,
  change,
  name,
  initial = '',
  onClose
}: {
  kind: keyof typeof FORM_WORDS
  /** Sends the text, trimmed. */
  change: UseMutationResult<Comment, Error, string>
  /** The form's name, beside the others the page shows. */
  name?: string
  initial?: string
  /** Closes a form opened from a comment. */
  onClose?: () => void
}): ReactElement {
  const { t } = useI18n()
  const words = FORM_WORDS[kind]
  const [body, setBody] = useState(initial)
  const text = body.trim()
  const sendable =
    !change.isPending && text !== '' && text.length <= MAX_COMMENT
  const send = () => {
    if (!sendable) return
    change.mutate(text, {
      onSuccess: () => {
        setBody('')
        onClose?.()
      }
    })
  }

  return (
    <form
      className="u-mt-1"
      aria-label={name}
      onSubmit={event => {
        event.preventDefault()
        send()
      }}
    >
      <TextField
        label={t(words.label)}
        placeholder={t(words.placeholder)}
        inputRef={onClose && focusOnMount}
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
          {t(words.hint)}
        </Typography>
        {onClose && (
          <Button variant="text" size="small" onClick={onClose}>
            {t('comments.cancel')}
          </Button>
        )}
        <Button type="submit" size="small" disabled={!sendable}>
          {t(words.submit)}
        </Button>
      </div>
      {change.isError && (
        <Typography role="alert" variant="caption" color="error">
          {t(words.failed)}
        </Typography>
      )}
    </form>
  )
}

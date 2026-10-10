import { Button, Typography } from '@linagora/twake-mui'
import type { UseMutationResult } from '@tanstack/react-query'
import { useMemo, useState, type ReactElement } from 'react'

import { SuggestionField } from '@/ds/Suggestions'
import { BEFORE_MENTION, type Comment } from '@/domain/comment'
import type { Page } from '@/domain/page'
import { displayName, sameEmail, type Person } from '@/domain/person'
import { focusOnMount } from '@/ui/focusOnMount'
import { useI18n, type TranslationKey } from '@/ui/i18n/useI18n'
import { matchingPeople } from '@/ui/people/people'
import { PersonAvatar } from '@/ui/people/PersonAvatar'
import { useSession } from '@/ui/session/SessionGate'
import { useAddComment, useEditComment, useSharing } from '@/ui/wiki/queries'

// What the backend takes of a comment, once trimmed.
const MAX_COMMENT = 10_000
// As many people as Twake Tasks suggests to mention.
const MAX_SUGGESTIONS = 8

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
  return <CommentForm kind="comment" wikiId={page.wikiId} change={add} />
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
      wikiId={page.wikiId}
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
      wikiId={page.wikiId}
      change={edit}
      initial={comment.body}
      onClose={onClose}
    />
  )
}

/**
 * The text of a comment, in plain text as the backend keeps it, where Twake
 * Tasks writes Markdown in TipTap. Ctrl+Enter sends it, and `@` suggests the
 * members to mention, as in Twake Tasks. A form opened from a comment takes
 * the focus as it opens, and closes once its text is sent.
 */
function CommentForm({
  kind,
  wikiId,
  change,
  name,
  initial = '',
  onClose
}: {
  kind: keyof typeof FORM_WORDS
  wikiId: string
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
  const mentionable = useMentionable(wikiId)
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
      <SuggestionField
        label={t(words.label)}
        placeholder={t(words.placeholder)}
        inputRef={onClose ? focusOnMount : null}
        value={body}
        onChange={setBody}
        onSubmit={send}
        suggestions={{
          trigger: '@',
          // The list opens where the backend reads a mention, after a
          // bracket or a quote too, where Twake Tasks' editor opens its list
          // after a space or at the start of a paragraph only, as Tasks reads
          // one.
          after: BEFORE_MENTION,
          label: t('comments.mentionsLabel'),
          search: query =>
            mentionable.search(query).map(person => ({
              key: person.id,
              insert: `@${person.email} `,
              // An option leaves what matched unmarked, where Twake Tasks
              // marks the words typed: Pages' Highlight marks the parts that
              // full text search found, and people come with none.
              label: (
                <>
                  <PersonAvatar email={person.email} name={person.name} />
                  <div className="u-ellipsis">
                    <Typography variant="body2" className="u-ellipsis">
                      {displayName(person)}
                    </Typography>
                    {displayName(person) !== person.email && (
                      <Typography
                        variant="caption"
                        color="textSecondary"
                        component="div"
                        className="u-ellipsis"
                      >
                        {person.email}
                      </Typography>
                    )}
                  </div>
                </>
              )
            }))
        }}
        helperText={mentionable.failed ? t('comments.mentionsFailed') : null}
        minRows={2}
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

/**
 * The members a comment may mention, best match first and by name among
 * equals, eight at most, as Twake Tasks suggests them once it has put a
 * task's assignees first: a page has none. Mentioning yourself tells nobody,
 * so the person comes last. An invitee is no member yet, and the backend
 * reads no mention of them.
 */
function useMentionable(wikiId: string): {
  search: (query: string) => Person[]
  /** The members could not be loaded. */
  failed: boolean
} {
  const { user } = useSession()
  const sharing = useSharing(wikiId)
  const members = sharing.data?.members
  const byName = useMemo(
    () =>
      (members ?? []).toSorted((a, b) =>
        displayName(a).localeCompare(displayName(b))
      ),
    [members]
  )
  const isMe = (person: Person) => sameEmail(person.email, user.email)
  return {
    search: query => {
      const found = matchingPeople(byName, query)
      return [
        ...found.filter(person => !isMe(person)),
        ...found.filter(isMe)
      ].slice(0, MAX_SUGGESTIONS)
    },
    failed: sharing.isError
  }
}

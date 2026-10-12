import type { Person } from '@/domain/person'

export interface Comment {
  id: string
  /** Replies are one level deep. */
  parentId: string | null
  author: Person
  /** Plain text, mentions written @email. */
  body: string
  createdAt: string
  editedAt: string | null
}

export type CommentPart = { text: string } | { mention: string }

/** The characters a mention may follow, unless it starts the text. */
export const BEFORE_MENTION = /[\s([{"']/u

// As the backend reads a mention (docs/api.md): @ and an email, at the start
// of the text or after a space, an opening bracket or a quote, so that the
// address in "bob@example.com" alone mentions no one. The email takes the
// characters Twake Tasks takes, though Tasks reads a mention after a space
// alone: plain text has no editor to set a mention apart, and prose writes
// brackets and quotes around one.
const MENTION = new RegExp(
  `(?<=^|${BEFORE_MENTION.source})@([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]*[A-Za-z0-9])`,
  'u'
)

export function commentParts(body: string): CommentPart[] {
  return body
    .split(MENTION)
    .map((piece, index) =>
      index % 2 === 0 ? { text: piece } : { mention: piece }
    )
    .filter(part => !('text' in part) || part.text !== '')
}

export function mentionsIn(body: string): string[] {
  const emails = commentParts(body).flatMap(part =>
    'mention' in part ? [part.mention.toLowerCase()] : []
  )
  return [...new Set(emails)]
}

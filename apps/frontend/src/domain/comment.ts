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

/** A piece of a comment's body: plain text, or the email of a mention. */
export type CommentPart = { text: string } | { mention: string }

// @ and an email, at the start of a word: the address in "bob@example.com"
// alone mentions no one.
const MENTION = /(?<=^|[\s([{"'])@([\w.+-]+@[\w-]+(?:\.[\w-]+)+)/u

export function commentParts(body: string): CommentPart[] {
  return body
    .split(MENTION)
    .map((piece, index) =>
      index % 2 === 0 ? { text: piece } : { mention: piece }
    )
    .filter(part => !('text' in part) || part.text !== '')
}

/** The emails a comment mentions, each once, in lower case. */
export function mentionsIn(body: string): string[] {
  const emails = commentParts(body).flatMap(part =>
    'mention' in part ? [part.mention.toLowerCase()] : []
  )
  return [...new Set(emails)]
}

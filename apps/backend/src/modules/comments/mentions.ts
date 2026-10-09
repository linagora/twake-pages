import { and, eq, inArray, sql } from 'drizzle-orm'
import type { Tx } from '../../infra/db.ts'
import { wikiMembers } from '../wikis/schema.ts'

// `@` and an email, read as the frontend's domain/comment.ts reads one: at
// the start of the text, or after a space, an opening bracket or a quote,
// which prose writes around a mention, where Twake Tasks reads one after a
// space alone. The email takes the characters Twake Tasks takes.
const MENTION =
  /(?<=^|[\s([{"'])@([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]*[A-Za-z0-9])/gu

/** The emails the text mentions, lowercased, in the order they first come. */
function mentionsIn(text: string) {
  return new Set(
    Array.from(text.matchAll(MENTION), match => (match[1] ?? '').toLowerCase())
  )
}

/**
 * The members of the wiki the text mentions that `before` did not, by the
 * email of their membership, in any case, in the order the text first
 * mentions them: those a new comment mentions, or those its edit mentions
 * anew.
 */
export async function membersMentioned(
  tx: Tx,
  wikiId: string,
  text: string,
  before = ''
) {
  const known = mentionsIn(before)
  const emails = [...mentionsIn(text)].filter(email => !known.has(email))
  if (emails.length === 0) return []
  const members = await tx
    .select({ userId: wikiMembers.userId, email: wikiMembers.email })
    .from(wikiMembers)
    .where(
      and(
        eq(wikiMembers.wikiId, wikiId),
        inArray(sql`lower(${wikiMembers.email})`, emails)
      )
    )
  const place = (email: string) => emails.indexOf(email.toLowerCase())
  return members.sort((one, other) => place(one.email) - place(other.email))
}

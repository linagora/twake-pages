import type { Person } from '@/domain/person'

// Twake Tasks' matching of people (ui/boards/people.ts), as its mentions
// suggest them.

const fold = (text: string): string =>
  text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()

const isSubsequence = (needle: string, haystack: string): boolean => {
  let at = 0
  for (const char of haystack) if (char === needle[at]) at++
  return at === needle.length
}

/** 0 when the person does not match; higher is a better match. */
export function matchScore(person: Person, query: string): number {
  // Split like the words of the person, so "jean_du" or "jean.du" finds
  // jean_dupont@
  const tokens = fold(query)
    .split(/[\s@._-]+/)
    .filter(Boolean)
  if (tokens.length === 0) return 1
  const words = fold([person.name ?? '', person.email].join(' '))
    .split(/[\s@._-]+/)
    .filter(Boolean)
  if (tokens.every(token => words.some(word => word.startsWith(token))))
    return 3
  const text = words.join(' ')
  if (tokens.every(token => text.includes(token))) return 2
  return isSubsequence(tokens.join(''), words.join('')) ? 1 : 0
}

/**
 * The people matching the query, best match first; all of them when it is
 * empty.
 */
export function matchingPeople(
  people: readonly Person[],
  query: string
): Person[] {
  if (!query) return [...people]
  return people
    .map(person => ({ person, score: matchScore(person, query) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score)
    .map(({ person }) => person)
}

import type { PageRef } from '@/domain/page'

export interface SearchResult {
  page: PageRef
  /** Plain text around the words found, each between U+E000 and U+E001. */
  excerpt: string
  updatedAt: string
}

export interface ExcerptPart {
  text: string
  highlighted: boolean
}

const FOUND_START = String.fromCharCode(0xe000)
const FOUND_END = String.fromCharCode(0xe001)

export function excerptParts(excerpt: string): ExcerptPart[] {
  const [before = '', ...found] = excerpt.split(FOUND_START)
  const parts = [
    { text: before, highlighted: false },
    ...found.flatMap(chunk => {
      const [word = '', after = ''] = chunk.split(FOUND_END)
      return [
        { text: word, highlighted: true },
        { text: after, highlighted: false }
      ]
    })
  ]
  return parts.filter(part => part.text !== '')
}

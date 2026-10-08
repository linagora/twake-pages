import type { PageRef } from '@/domain/page'

export interface SearchResult {
  page: PageRef
  /** Plain text around the words found, each between U+E000 and U+E001. */
  excerpt: string
  updatedAt: string
}

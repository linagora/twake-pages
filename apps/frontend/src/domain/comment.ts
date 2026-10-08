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

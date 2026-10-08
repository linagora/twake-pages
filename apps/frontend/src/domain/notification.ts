import type { Person } from '@/domain/person'
import type { WikiRef } from '@/domain/wiki'

export type NotificationReason = 'published' | 'commented' | 'mentioned'

export interface Notification {
  id: string
  reason: NotificationReason
  page: { id: string; title: string }
  wiki: WikiRef
  actor: Person
  /** Set for published. */
  version: number | null
  /** Set for commented and mentioned. */
  commentId: string | null
  createdAt: string
  readAt: string | null
}

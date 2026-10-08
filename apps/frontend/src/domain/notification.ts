import type { Person } from '@/domain/person'

export type NotificationReason = 'published' | 'commented' | 'mentioned'

export interface Notification {
  id: string
  reason: NotificationReason
  page: { id: string; title: string }
  wiki: { id: string; name: string }
  actor: Person
  /** Set for published. */
  version: number | null
  /** Set for commented and mentioned. */
  commentId: string | null
  createdAt: string
  readAt: string | null
}

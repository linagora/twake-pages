import type { Person } from '@/domain/person'

export const ROLES = ['viewer', 'editor', 'admin'] as const
export type Role = (typeof ROLES)[number]

export type WikiKind = 'personal' | 'shared' | 'space'

/** The wiki a page or a notification belongs to. */
export interface WikiRef {
  id: string
  name: string
  kind: WikiKind
}

export interface WikiSummary {
  id: string
  name: string
  description: string
  kind: WikiKind
  role: Role
  homePageId: string
  /** The person's unread notifications about pages of this wiki. */
  unread: number
}

export interface Wiki extends WikiSummary {
  /** Moves with every change of the wiki, for live updates. */
  version: number
}

export interface Member extends Person {
  role: Role
  joinedAt: string
}

/** A role given to an email that has not signed in yet. */
export interface Invite {
  id: string
  email: string
  role: Role
  createdAt: string
}

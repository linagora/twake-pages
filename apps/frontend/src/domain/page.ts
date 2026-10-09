import type { Person } from '@/domain/person'
import type { WikiRef } from '@/domain/wiki'

export type PageKind = 'document' | 'database'

/** A BlockNote block, stored as sent. */
export type Block = Record<string, unknown>

export interface TreePage {
  id: string
  /** Null at the top of the tree. */
  parentId: string | null
  /** A fractional key: compare with < on strings. */
  position: string
  title: string
  kind: PageKind
}

export interface Page {
  id: string
  wikiId: string
  parentId: string | null
  home: boolean
  kind: PageKind
  title: string
  /** [] for a database page. */
  content: Block[]
  /** Set for a database page. */
  gristUrl: string | null
  /** The number of the current version, from 1. */
  version: number
  createdAt: string
  createdBy: Person
  /** The time of the current version. */
  updatedAt: string
  /** The author of the current version. */
  updatedBy: Person
  /** Label names, sorted. */
  labels: string[]
  /** From the top of the tree down to the parent. */
  ancestors: { id: string; title: string }[]
  following: boolean
  favorite: boolean
  deletedAt: string | null
}

/**
 * A text as the backend reads a label name: trimmed, lowercased, then composed
 * (NFC), so that an "é" typed in one character or in two makes one label.
 */
export function normalizeLabelName(text: string): string {
  return text.trim().toLowerCase().normalize('NFC')
}

export interface VersionSummary {
  number: number
  title: string
  author: Person
  createdAt: string
  restoredFrom: number | null
}

export interface Version extends VersionSummary {
  content: Block[]
  gristUrl: string | null
}

export interface PageRef {
  id: string
  title: string
  wiki: WikiRef
}

/** The root of a deleted branch. */
export interface TrashEntry {
  id: string
  title: string
  deletedAt: string
  deletedBy: Person
  /** The pages deleted with it. */
  descendants: number
}

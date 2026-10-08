import type { NewVersion } from '@/application/pages'
import type { Block } from '@/domain/page'

/**
 * Changes made in the editor and not published yet: the version of blocks
 * publishing sends, with the version it started from.
 */
export type Draft = Extract<NewVersion, { content: Block[] }>

// In this browser only, per person and page: a draft never reaches the
// server (ADR 012). The session knows a person by their email, so a person
// without one keeps no draft.
const keyOf = (person: string, pageId: string) =>
  `twake-pages.draft.${person}.${pageId}`

const isDraft = (value: unknown): value is Draft =>
  typeof value === 'object' &&
  value !== null &&
  'baseVersion' in value &&
  Number.isInteger(value.baseVersion) &&
  'title' in value &&
  typeof value.title === 'string' &&
  'content' in value &&
  Array.isArray(value.content)

/** The draft the person left on the page, if the browser kept it. */
export function keptDraft(person: string | null, pageId: string): Draft | null {
  if (!person) return null
  try {
    const kept = localStorage.getItem(keyOf(person, pageId))
    const value: unknown = kept === null ? null : JSON.parse(kept)
    return isDraft(value) ? value : null
  } catch {
    // Storage the browser refuses, or a draft it no longer reads.
    return null
  }
}

export function keepDraft(
  person: string | null,
  pageId: string,
  draft: Draft
): void {
  if (!person) return
  try {
    localStorage.setItem(keyOf(person, pageId), JSON.stringify(draft))
  } catch {
    // Refused or over the quota: the draft stays in the editor only.
  }
}

export function dropDraft(person: string | null, pageId: string): void {
  if (!person) return
  try {
    localStorage.removeItem(keyOf(person, pageId))
  } catch {
    // Storage the browser refuses kept nothing.
  }
}

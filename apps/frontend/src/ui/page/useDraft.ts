import { useCallback, useEffect, useState } from 'react'

import type { Page } from '@/domain/page'
import { dropDraft, keepDraft, keptDraft, type Draft } from '@/ui/page/drafts'
import { useSession } from '@/ui/session/SessionGate'

const draftOf = (page: Page): Draft => ({
  baseVersion: page.version,
  title: page.title,
  content: page.content
})

interface PageDraft {
  /** The draft the person left on the page, which the browser kept. */
  kept: Draft | null
  /** The draft as the editor opened it. */
  start: Draft
  draft: Draft
  change: (fields: Partial<Pick<Draft, 'title' | 'content'>>) => void
  /** Forgets the draft, published or discarded. */
  drop: () => void
}

/**
 * The draft of the page the person writes, from the one they left on it, or
 * else from the version the page shows first: a newer one, published
 * meanwhile, does not move the draft. The browser keeps it from its first
 * change on, and not before.
 */
export function useDraft(page: Page): PageDraft {
  const person = useSession().user.email
  const [kept] = useState(() => keptDraft(person, page.id))
  const [start] = useState(() => kept ?? draftOf(page))
  const [draft, setDraft] = useState(start)

  useEffect(() => {
    if (draft !== start) keepDraft(person, page.id, draft)
  }, [draft, start, person, page.id])

  const change = useCallback(
    (fields: Partial<Pick<Draft, 'title' | 'content'>>) => {
      setDraft(current => ({ ...current, ...fields }))
    },
    []
  )

  const drop = useCallback(() => {
    dropDraft(person, page.id)
  }, [person, page.id])

  return { kept, start, draft, change, drop }
}

import { lazy, Suspense, type ReactElement } from 'react'

import { blockNoteChunk } from '@/ds/blockNoteChunk'
import { ListSkeleton } from '@/ds/EmptyState'

const BlocksEditorView = lazy(async () => ({
  default: (await blockNoteChunk.editor()).BlocksEditorView
}))

/**
 * Blocks of BlockNote, written in its editor from `initial` on. `onChange`
 * receives every change.
 */
export function BlocksEditor({
  initial,
  label,
  lang,
  loadingLabel,
  onChange
}: {
  initial: Record<string, unknown>[]
  /** Names the editor for screen readers. */
  label: string
  lang: string
  /** Names the placeholder shown while BlockNote loads. */
  loadingLabel: string
  onChange: (blocks: Record<string, unknown>[]) => void
}): ReactElement {
  return (
    <Suspense fallback={<ListSkeleton label={loadingLabel} rows={2} />}>
      <BlocksEditorView
        initial={initial}
        label={label}
        lang={lang}
        onChange={onChange}
      />
    </Suspense>
  )
}

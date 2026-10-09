import { lazy, Suspense, type ReactElement } from 'react'

import { blockNoteChunk } from '@/ds/blockNoteChunk'
import type { BlockOptions } from '@/ds/editorBlocks'
import { ListSkeleton } from '@/ds/EmptyState'

const BlocksEditorView = lazy(async () => ({
  default: (await blockNoteChunk.editor()).BlocksEditorView
}))

/**
 * Blocks of BlockNote, written in its editor from `initial` on. `onChange`
 * receives every change, with the blocks the editor does not write as
 * `initial` holds them.
 */
export function BlocksEditor({
  initial,
  label,
  lang,
  loadingLabel,
  options,
  onChange
}: {
  initial: Record<string, unknown>[]
  /** Names the editor for screen readers. */
  label: string
  lang: string
  /** Names the placeholder shown while BlockNote loads. */
  loadingLabel: string
  options: BlockOptions
  onChange: (blocks: Record<string, unknown>[]) => void
}): ReactElement {
  return (
    <Suspense fallback={<ListSkeleton label={loadingLabel} rows={2} />}>
      <BlocksEditorView
        initial={initial}
        label={label}
        lang={lang}
        options={options}
        onChange={onChange}
      />
    </Suspense>
  )
}

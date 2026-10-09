import { lazy, Suspense, type ReactElement } from 'react'

import { blockNoteChunk } from '@/ds/blockNoteChunk'
import type { BlockOptions } from '@/ds/editorBlocks'
import { ListSkeleton } from '@/ds/EmptyState'

const BlocksHtml = lazy(async () => ({
  default: (await blockNoteChunk.html()).BlocksHtml
}))

/** Blocks of BlockNote, the editor of the pages, shown read only. */
export function Blocks({
  blocks,
  options,
  loadingLabel
}: {
  blocks: Record<string, unknown>[]
  options: BlockOptions
  /** Names the placeholder shown while BlockNote loads. */
  loadingLabel: string
}): ReactElement {
  return (
    <Suspense fallback={<ListSkeleton label={loadingLabel} rows={2} />}>
      <BlocksHtml blocks={blocks} options={options} />
    </Suspense>
  )
}

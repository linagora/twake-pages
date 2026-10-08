import { lazy, Suspense, type ReactElement } from 'react'

import { blockNoteChunk } from '@/ds/blockNoteChunk'
import { ListSkeleton } from '@/ds/EmptyState'

const BlocksHtml = lazy(async () => ({
  default: (await blockNoteChunk.html()).BlocksHtml
}))

/** Blocks of BlockNote, the editor of the pages, shown read only. */
export function Blocks({
  blocks,
  loadingLabel
}: {
  blocks: Record<string, unknown>[]
  /** Names the placeholder shown while BlockNote loads. */
  loadingLabel: string
}): ReactElement {
  return (
    <Suspense fallback={<ListSkeleton label={loadingLabel} rows={2} />}>
      <BlocksHtml blocks={blocks} />
    </Suspense>
  )
}

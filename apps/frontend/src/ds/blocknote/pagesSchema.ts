import {
  BlockNoteSchema,
  defaultBlockSpecs,
  type BlockSpecs
} from '@blocknote/core'

import { keptBlockSpec } from '@/ds/blocknote/KeptBlock'
import { KEPT_BLOCK } from '@/ds/editorBlocks'

/** The type of one of BlockNote's blocks. */
export type BlockNoteType = keyof typeof defaultBlockSpecs

/**
 * The schema of the blocks of the pages: those of `types`, and the kept
 * block, named by `kindOf`. Its blocks are given as any blocks, as
 * BlockNote's heading fails BlockNote's own constraint on them under
 * exactOptionalPropertyTypes (its optional isToggleable); spread, they type
 * as the kept block alone.
 */
export const pagesSchema = (
  types: readonly BlockNoteType[],
  { kindOf }: { kindOf: (type: string) => string }
) =>
  BlockNoteSchema.create<BlockSpecs>({
    blockSpecs: {
      ...Object.fromEntries(types.map(type => [type, defaultBlockSpecs[type]])),
      [KEPT_BLOCK]: keptBlockSpec({ kindOf })
    }
  })

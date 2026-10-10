import {
  BlockNoteSchema,
  defaultBlockSpecs,
  type BlockNoteEditor,
  type BlockSpecs
} from '@blocknote/core'

import { gristEmbedSpec } from '@/ds/blocknote/GristEmbed'
import { keptBlockSpec } from '@/ds/blocknote/KeptBlock'
import { GRIST_EMBED, KEPT_BLOCK, type BlockOptions } from '@/ds/editorBlocks'

/** The type of one of BlockNote's blocks. */
export type BlockNoteType = keyof typeof defaultBlockSpecs

/** The type of a block of the pages: one of BlockNote's, or the Grist embed. */
export type PagesBlockType = BlockNoteType | typeof GRIST_EMBED

/**
 * The schema of the blocks of the pages: those of `types`, a Grist embed
 * framing documents as `grist` tells, and the kept block, named by `kindOf`.
 * Its blocks are given as any blocks, as BlockNote's heading fails
 * BlockNote's own constraint on them under exactOptionalPropertyTypes (its
 * optional isToggleable); spread, they type as the kept block alone.
 */
export const pagesSchema = (
  types: readonly PagesBlockType[],
  { kindOf, grist }: BlockOptions
) =>
  BlockNoteSchema.create<BlockSpecs>({
    blockSpecs: {
      ...Object.fromEntries(
        types.map(type => [
          type,
          type === GRIST_EMBED ? gristEmbedSpec(grist) : defaultBlockSpecs[type]
        ])
      ),
      [KEPT_BLOCK]: keptBlockSpec({ kindOf })
    }
  })

type PagesSchema = ReturnType<typeof pagesSchema>

/** An editor of the blocks of the pages. */
export type PagesEditor = BlockNoteEditor<
  PagesSchema['blockSchema'],
  PagesSchema['inlineContentSchema'],
  PagesSchema['styleSchema']
>

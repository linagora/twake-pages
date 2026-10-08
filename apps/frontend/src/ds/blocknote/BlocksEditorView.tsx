import '@blocknote/mantine/style.css'

import {
  BlockNoteSchema,
  defaultBlockSpecs,
  type BlockSpecs
} from '@blocknote/core'
import { en, fr } from '@blocknote/core/locales'
// Of the three UI packages of BlockNote, the one its docs recommend for new
// projects (blocknotejs.org/docs/getting-started). The ShadCN one is for apps
// already on ShadCN and Tailwind CSS, a peer dependency this app has not; the
// Ariakit one, the docs offer without recommending it.
import { BlockNoteView } from '@blocknote/mantine'
import { useCreateBlockNote } from '@blocknote/react'
import { useColorScheme } from '@linagora/twake-mui'
import type { ReactElement } from 'react'

import { EDITOR_BLOCKS } from '@/ds/editorBlocks'

type Blocks = Record<string, unknown>[]

// Neither the block menu nor a paste makes a block the schema lacks. Its
// blocks are given as any blocks, as BlockNote's heading fails BlockNote's
// own constraint on them under exactOptionalPropertyTypes (its optional
// isToggleable).
const schema = BlockNoteSchema.create<BlockSpecs>({
  // @ts-expect-error -- the heading, as above.
  blockSpecs: Object.fromEntries(
    EDITOR_BLOCKS.map(type => [type, defaultBlockSpecs[type]])
  )
})

/**
 * BlockNote, the editor of the pages, writing blocks from `initial` on,
 * which hold only blocks it writes (see editableBlocks).
 */
export function BlocksEditorView({
  initial,
  label,
  lang,
  onChange
}: {
  initial: Blocks
  label: string
  lang: string
  onChange: (blocks: Blocks) => void
}): ReactElement {
  const editor = useCreateBlockNote({
    schema,
    dictionary: lang === 'fr' ? fr : en,
    ...(initial.length > 0 && { initialContent: initial }),
    domAttributes: {
      editor: { role: 'textbox', 'aria-multiline': 'true', 'aria-label': label }
    }
  })
  const { mode, systemMode } = useColorScheme()
  const dark = (mode === 'system' ? systemMode : mode) === 'dark'

  return (
    <BlockNoteView
      editor={editor}
      theme={dark ? 'dark' : 'light'}
      onChange={() => {
        onChange(editor.document)
      }}
    />
  )
}

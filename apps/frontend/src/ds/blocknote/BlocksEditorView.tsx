import '@blocknote/mantine/style.css'

import { en, fr } from '@blocknote/core/locales'
// Of the three UI packages of BlockNote, the one its docs recommend for new
// projects (blocknotejs.org/docs/getting-started). The ShadCN one is for apps
// already on ShadCN and Tailwind CSS, a peer dependency this app has not; the
// Ariakit one, the docs offer without recommending it.
import { BlockNoteView } from '@blocknote/mantine'
import { useCreateBlockNote } from '@blocknote/react'
import { Box, useColorScheme } from '@linagora/twake-mui'
import { useState, type ReactElement } from 'react'

import {
  keptBlockStyles,
  pastesWithoutKeptBlocks
} from '@/ds/blocknote/KeptBlock'
import { pagesSchema } from '@/ds/blocknote/pagesSchema'
import {
  EDITOR_BLOCKS,
  fromEditor,
  toEditor,
  type BlockOptions
} from '@/ds/editorBlocks'
import { gristStyles } from '@/ds/grist'

type Blocks = Record<string, unknown>[]

/**
 * BlockNote, the editor of the pages, writing blocks from `initial` on. A
 * block it does not write, it keeps as stored (see toEditor), named by
 * `options.kindOf`: the block menu does not offer the kept block, and a
 * paste does not make it (see pastesWithoutKeptBlocks). A Grist embed
 * frames its document as `options.grist` tells.
 */
export function BlocksEditorView({
  initial,
  label,
  lang,
  options,
  onChange
}: {
  initial: Blocks
  label: string
  lang: string
  options: BlockOptions
  onChange: (blocks: Blocks) => void
}): ReactElement {
  // Made once, as the editor is.
  const [schema] = useState(() => pagesSchema(EDITOR_BLOCKS, options))
  const editor = useCreateBlockNote({
    schema,
    dictionary: lang === 'fr' ? fr : en,
    ...(initial.length > 0 && { initialContent: toEditor(initial) }),
    extensions: [pastesWithoutKeptBlocks()],
    domAttributes: {
      editor: { role: 'textbox', 'aria-multiline': 'true', 'aria-label': label }
    }
  })
  const { mode, systemMode } = useColorScheme()
  const dark = (mode === 'system' ? systemMode : mode) === 'dark'

  return (
    <Box sx={[keptBlockStyles, gristStyles]}>
      <BlockNoteView
        editor={editor}
        theme={dark ? 'dark' : 'light'}
        onChange={() => {
          onChange(fromEditor(editor.document))
        }}
      />
    </Box>
  )
}

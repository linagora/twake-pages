import '@blocknote/mantine/style.css'

import {
  FilePanelExtension,
  filterSuggestionItems,
  insertOrUpdateBlockForSlashMenu,
  type SuggestionMenuOptions
} from '@blocknote/core/extensions'
import { en, fr } from '@blocknote/core/locales'
// Of the three UI packages of BlockNote, the one its docs recommend for new
// projects (blocknotejs.org/docs/getting-started). The ShadCN one is for apps
// already on ShadCN and Tailwind CSS, a peer dependency this app has not; the
// Ariakit one, the docs offer without recommending it.
import { BlockNoteView } from '@blocknote/mantine'
import {
  FormattingToolbarController,
  getDefaultReactSlashMenuItems,
  SuggestionMenuController,
  useCreateBlockNote,
  type DefaultReactSuggestionItem
} from '@blocknote/react'
import { Database, Icon } from '@linagora/twake-icons'
import { Box, useColorScheme } from '@linagora/twake-mui'
import { useCallback, useState, type ReactElement } from 'react'

import { withGristWords } from '@/ds/blocknote/GristEmbed'
import {
  keptBlockStyles,
  pastesWithoutKeptBlocks
} from '@/ds/blocknote/KeptBlock'
import { pagesSchema, type PagesEditor } from '@/ds/blocknote/pagesSchema'
import { PagesToolbar } from '@/ds/blocknote/PagesToolbar'
import {
  EDITOR_BLOCKS,
  fromEditor,
  GRIST_EMBED,
  toEditor,
  type BlockOptions
} from '@/ds/editorBlocks'
import { gristStyles, type GristOptions } from '@/ds/grist'

type Blocks = Record<string, unknown>[]

// Where BlockNote opens its own block menu: out of the cells of a table.
const outOfTables: SuggestionMenuOptions['shouldOpen'] = tr =>
  !tr.selection.$from.parent.type.isInGroup('tableContent')

/**
 * The items of the block menu: BlockNote's, and the Grist embed after its
 * media, which asks for its address at once, as an image does.
 */
function blockMenuItems(
  editor: PagesEditor,
  { origins, labels }: GristOptions
): DefaultReactSuggestionItem[] {
  const items = getDefaultReactSlashMenuItems(editor)
  // Where the pages frame no Grist, a Grist embed would show none.
  if (origins.length === 0) return items
  const media = editor.dictionary.slash_menu.image.group
  const last = items.findLastIndex(item => item.group === media)
  return items.toSpliced(last === -1 ? items.length : last + 1, 0, {
    title: labels.insert,
    subtext: labels.insertHint,
    group: media,
    icon: <Icon icon={Database} size={18} />,
    onItemClick: () => {
      const embed = insertOrUpdateBlockForSlashMenu(editor, {
        type: GRIST_EMBED
      })
      editor.getExtension(FilePanelExtension)?.showMenu(embed.id)
    }
  })
}

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
    dictionary: withGristWords(lang === 'fr' ? fr : en, options.grist.labels),
    ...(initial.length > 0 && { initialContent: toEditor(initial) }),
    extensions: [pastesWithoutKeptBlocks()],
    domAttributes: {
      editor: { role: 'textbox', 'aria-multiline': 'true', 'aria-label': label }
    }
  })
  const menuItems = useCallback(
    (query: string) =>
      Promise.resolve(
        filterSuggestionItems(blockMenuItems(editor, options.grist), query)
      ),
    [editor, options.grist]
  )
  const { mode, systemMode } = useColorScheme()
  const dark = (mode === 'system' ? systemMode : mode) === 'dark'

  return (
    <Box sx={[keptBlockStyles, gristStyles]}>
      <BlockNoteView
        editor={editor}
        theme={dark ? 'dark' : 'light'}
        formattingToolbar={false}
        slashMenu={false}
        onChange={() => {
          onChange(fromEditor(editor.document))
        }}
      >
        <FormattingToolbarController formattingToolbar={PagesToolbar} />
        <SuggestionMenuController
          triggerCharacter="/"
          shouldOpen={outOfTables}
          getItems={menuItems}
        />
      </BlockNoteView>
    </Box>
  )
}

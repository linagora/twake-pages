import '@blocknote/mantine/style.css'

import { en, fr } from '@blocknote/core/locales'
// Of the three UI packages of BlockNote, the one its docs recommend for new
// projects (blocknotejs.org/docs/getting-started). The ShadCN one is for apps
// already on ShadCN and Tailwind CSS, a peer dependency this app has not; the
// Ariakit one, the docs offer without recommending it.
import { BlockNoteView } from '@blocknote/mantine'
import { useCreateBlockNote } from '@blocknote/react'
import { useColorScheme } from '@linagora/twake-mui'
import type { ReactElement } from 'react'

type Blocks = Record<string, unknown>[]

/** BlockNote, the editor of the pages, writing blocks from `initial` on. */
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
      // @ts-expect-error -- BlockNote's default schema fails its own
      // constraint under exactOptionalPropertyTypes (an optional prop of the
      // heading), so the view takes it for any schema, which the editor of the
      // default one is not.
      editor={editor}
      theme={dark ? 'dark' : 'light'}
      onChange={() => {
        onChange(editor.document)
      }}
    />
  )
}

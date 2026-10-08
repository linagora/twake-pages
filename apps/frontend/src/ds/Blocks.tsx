import '@blocknote/core/style.css'

import { BlockNoteEditor } from '@blocknote/core'
import { Box, useColorScheme } from '@linagora/twake-mui'
import { useCallback, type ReactElement } from 'react'

/**
 * Blocks of BlockNote, the editor of the pages, shown read only: the editor
 * is mounted as is, since its React view only adds the menus for writing.
 */
export function Blocks({
  blocks
}: {
  blocks: Record<string, unknown>[]
}): ReactElement {
  const { mode, systemMode } = useColorScheme()
  const dark = (mode === 'system' ? systemMode : mode) === 'dark'
  const mount = useCallback(
    (element: HTMLDivElement | null) => {
      if (!element) return
      const editor = BlockNoteEditor.create({
        initialContent: blocks,
        // Read, not written: no text field for screen readers, and no stop
        // in the tab order.
        domAttributes: { editor: { role: 'none', tabIndex: '-1' } }
      })
      editor.isEditable = false
      editor.mount(element)
      return () => {
        editor.unmount()
      }
    },
    [blocks]
  )

  return (
    <Box
      className="bn-root bn-container"
      data-color-scheme={dark ? 'dark' : 'light'}
      sx={theme => ({
        // In the type and colors of the app, without the margin the editor
        // keeps for its side menu.
        '--bn-colors-editor-text': theme.vars.palette.text.primary,
        '--bn-colors-editor-background': 'transparent',
        '& .bn-editor': { paddingInline: 0 },
        '& .bn-default-styles': { fontFamily: theme.typography.fontFamily }
      })}
    >
      <div ref={mount} />
    </Box>
  )
}

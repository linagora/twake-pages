import { en } from '@blocknote/core/locales'
import { BlockNoteView } from '@blocknote/mantine'
import { useCreateBlockNote } from '@blocknote/react'
import { render, screen } from '@testing-library/react'
import { useEffect, type ReactElement } from 'react'
import { describe, expect, it } from 'vitest'

import { withGristWords } from '@/ds/blocknote/GristEmbed'
import { pagesSchema } from '@/ds/blocknote/pagesSchema'
import { PagesToolbar } from '@/ds/blocknote/PagesToolbar'
import { EDITOR_BLOCKS, toEditor, type BlockOptions } from '@/ds/editorBlocks'
import { BUDGET, GRIST_ORIGIN } from '@/testing/fakePagesApi'

const OPTIONS: BlockOptions = {
  kindOf: type => type,
  grist: {
    origins: [GRIST_ORIGIN],
    labels: {
      frame: 'Grist document',
      open: 'Open in Grist',
      offOrigins: 'This Grist document is not shown.',
      insert: 'Grist document',
      insertHint: 'Shows a Grist document, or one of its pages',
      add: 'Add Grist document',
      embed: 'Embed Grist document',
      replace: 'Replace Grist document',
      remove: 'Remove from the page'
    }
  }
}

/**
 * The toolbar of the editor of `block`, selected as a click selects it, which
 * jsdom cannot do.
 */
function ToolbarOf({
  block
}: {
  block: Record<string, unknown>
}): ReactElement {
  const editor = useCreateBlockNote({
    schema: pagesSchema(EDITOR_BLOCKS, OPTIONS),
    dictionary: withGristWords(en, OPTIONS.grist.labels),
    initialContent: toEditor([block])
  })
  useEffect(() => {
    const [selected] = editor.document
    if (selected) editor.setTextCursorPosition(selected)
  }, [editor])

  return (
    <BlockNoteView editor={editor} formattingToolbar={false}>
      <PagesToolbar />
    </BlockNoteView>
  )
}

describe('the toolbar of the editor', () => {
  it('offers to replace or remove a Grist embed, named for its document, not to open its address', async () => {
    render(<ToolbarOf block={{ type: 'gristEmbed', props: { url: BUDGET } }} />)

    expect(
      await screen.findByRole('button', { name: 'Replace Grist document' })
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Remove from the page' })
    ).toBeInTheDocument()
    expect(screen.getAllByRole('button')).toHaveLength(2)
  })

  it('offers to download an image, as BlockNote does', async () => {
    render(
      <ToolbarOf
        block={{
          type: 'image',
          props: { url: 'https://images.example.com/team.png' }
        }}
      />
    )

    expect(
      await screen.findByRole('button', { name: 'Download image' })
    ).toBeInTheDocument()
  })
})

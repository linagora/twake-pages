import { BlockNoteEditor } from '@blocknote/core'
import { act, fireEvent } from '@testing-library/react'

import type { Block } from '@/domain/page'

/**
 * Types `text` in the last paragraph of a BlockNote editor, as Twake Tasks
 * types in its rich text: ProseMirror reads typing from DOM mutations, which
 * jsdom reports on a microtask.
 */
export async function typeInBlocks(
  editor: HTMLElement,
  text: string
): Promise<void> {
  const paragraph = [...editor.querySelectorAll('p')].at(-1)
  if (!paragraph) throw new Error('The editor has no paragraph to type in')
  paragraph.textContent = text
  fireEvent.input(editor)
  await act(async () => {
    await Promise.resolve()
  })
}

/** Pastes in a BlockNote editor what the clipboard holds, by its type. */
export async function pasteInBlocks(
  editor: HTMLElement,
  clipboard: Record<string, string>
): Promise<void> {
  fireEvent.paste(editor, {
    clipboardData: {
      types: Object.keys(clipboard),
      getData: (type: string) => clipboard[type] ?? ''
    }
  })
  await act(async () => {
    await Promise.resolve()
  })
}

/**
 * The clipboard of `blocks` copied from another BlockNote editor, such as
 * Docs, which knows every block of BlockNote.
 */
export function copiedFromBlockNote(blocks: Block[]): Record<string, string> {
  const editor = BlockNoteEditor.create({ initialContent: blocks })
  return { 'blocknote/html': editor.blocksToFullHTML(editor.document) }
}

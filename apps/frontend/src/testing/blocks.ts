import { BlockNoteEditor } from '@blocknote/core'
import { act, fireEvent, within } from '@testing-library/react'

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

/**
 * Presses Backspace in a BlockNote editor at the start of the paragraph that
 * shows `text`, which ProseMirror reads from the selection of the document
 * once told it changed.
 */
export async function backspaceBefore(
  editor: HTMLElement,
  text: string
): Promise<void> {
  const start = within(editor).getByText(text).firstChild
  if (!start) throw new Error(`No text in the paragraph of "${text}"`)
  editor.focus()
  document.getSelection()?.collapse(start, 0)
  fireEvent(document, new Event('selectionchange'))
  fireEvent.keyDown(editor, { key: 'Backspace', keyCode: 8 })
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

/**
 * Copies all the blocks of a BlockNote editor, and gives the clipboard it
 * fills, by type. ProseMirror reads the selection of the document once told
 * it changed.
 */
export function copyAllInBlocks(editor: HTMLElement): Record<string, string> {
  const clipboard: Record<string, string> = {}
  editor.focus()
  document.getSelection()?.selectAllChildren(editor)
  fireEvent(document, new Event('selectionchange'))
  fireEvent.copy(editor, {
    clipboardData: {
      clearData: () => undefined,
      setData: (type: string, data: string) => {
        clipboard[type] = data
      }
    }
  })
  return clipboard
}

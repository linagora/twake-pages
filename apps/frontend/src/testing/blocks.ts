import { act, fireEvent } from '@testing-library/react'

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

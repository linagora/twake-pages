/**
 * BlockNote, which weighs more than the rest of the app, in its own chunk,
 * loaded the first time a page shows its blocks, read only or in the editor.
 */
export const blockNoteChunk = {
  html: () => import('@/ds/blocknote/BlocksHtml'),
  editor: () => import('@/ds/blocknote/BlocksEditorView')
}

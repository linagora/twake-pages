/**
 * BlockNote, which weighs more than the rest of the app, in its own chunk,
 * loaded the first time a page shows its blocks.
 */
export const blockNoteChunk = {
  html: () => import('@/ds/blocknote/BlocksHtml')
}

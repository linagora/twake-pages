import { BlockNoteEditor } from '@blocknote/core'
import { Box } from '@linagora/twake-mui'
import { useCallback, type ReactElement } from 'react'

import { keptBlockStyles } from '@/ds/blocknote/KeptBlock'
import { pagesSchema } from '@/ds/blocknote/pagesSchema'
import { sanitizedHtml } from '@/ds/blocknote/sanitizedHtml'
import {
  EDITOR_BLOCKS,
  withOthersKept,
  type BlockOptions
} from '@/ds/editorBlocks'
import { gristStyles } from '@/ds/grist'

type Blocks = Record<string, unknown>[]

/**
 * The blocks shown as BlockNote exports them: those the editor writes, and
 * BlockNote's video, audio and file ones, as a player or a link. A block of
 * another type shows as the editor shows it, in a kept block.
 */
const SHOWN_BLOCKS = [...EDITOR_BLOCKS, 'video', 'audio', 'file'] as const
const shown: ReadonlySet<unknown> = new Set(SHOWN_BLOCKS)

// What each element shows. React's strict mode attaches a ref twice, and the
// second time after the first nodes may have been found: the same blocks,
// with the same options, keep them.
const shownBy = new WeakMap<
  HTMLElement,
  { blocks: Blocks; options: BlockOptions }
>()

/**
 * Blocks of BlockNote, the editor of the pages, shown read only as the HTML
 * it exports: its editor draws a list item as a paragraph, which a screen
 * reader does not read as a list. Others write the blocks, so the HTML is
 * sanitized. `options.kindOf` names the kind of a block of another type, and
 * `options.grist` tells where a Grist embed frames its document from.
 */
export function BlocksHtml({
  blocks,
  options
}: {
  blocks: Blocks
  options: BlockOptions
}): ReactElement {
  const show = useCallback(
    (element: HTMLDivElement | null) => {
      if (!element) return
      const before = shownBy.get(element)
      if (before?.blocks === blocks && before.options === options) return
      shownBy.set(element, { blocks, options })
      const editor = BlockNoteEditor.create({
        schema: pagesSchema(SHOWN_BLOCKS, options),
        initialContent: withOthersKept(blocks, shown)
      })
      const html = sanitizedHtml(
        editor.blocksToHTMLLossy(),
        options.grist.origins
      )
      // As the editor shows a check list item when it is not editable.
      for (const box of html.querySelectorAll('input')) box.disabled = true
      // The blocks show under a title, which is the h1: each of their
      // headings goes one level down, and h6 takes the two deepest.
      for (const heading of html.querySelectorAll('h1, h2, h3, h4, h5')) {
        const level = Number(heading.tagName.charAt(1)) + 1
        const below = document.createElement(`h${String(level)}`)
        for (const { name, value } of heading.attributes) {
          below.setAttribute(name, value)
        }
        below.append(...heading.childNodes)
        heading.replaceWith(below)
      }
      element.replaceChildren(html)
    },
    [blocks, options]
  )

  return (
    <Box
      ref={show}
      sx={[
        theme => ({
          // The exported HTML comes without styles: its lists as Twake Tasks
          // styles those of its rich text, and nothing wider than the page.
          '& li > p': { margin: 0 },
          '& li:has(> input)': { listStyle: 'none' },
          '& li > input + p': { display: 'inline' },
          '& pre': { overflowX: 'auto' },
          '& img, & video': { maxWidth: '100%' },
          '& table': { borderCollapse: 'collapse' },
          '& th, & td': {
            border: `1px solid ${theme.vars.palette.divider}`,
            padding: theme.spacing(0.5, 1)
          }
        }),
        keptBlockStyles,
        gristStyles
      ]}
    />
  )
}

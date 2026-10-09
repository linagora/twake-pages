import { BlockNoteEditor } from '@blocknote/core'
import { Box } from '@linagora/twake-mui'
import DOMPurify from 'dompurify'
import { useCallback, type ReactElement } from 'react'

// The blocks each element shows. React's strict mode attaches a ref twice,
// and the second time after the first nodes may have been found: the same
// blocks keep them.
const blocksShownBy = new WeakMap<HTMLElement, Record<string, unknown>[]>()

/**
 * Blocks of BlockNote, the editor of the pages, shown read only as the HTML
 * it exports: its editor draws a list item as a paragraph, which a screen
 * reader does not read as a list. Others write the blocks, so the HTML is
 * sanitized.
 */
export function BlocksHtml({
  blocks
}: {
  blocks: Record<string, unknown>[]
}): ReactElement {
  const show = useCallback(
    (element: HTMLDivElement | null) => {
      if (!element || blocksShownBy.get(element) === blocks) return
      blocksShownBy.set(element, blocks)
      const editor = BlockNoteEditor.create({ initialContent: blocks })
      const html = DOMPurify.sanitize(editor.blocksToHTMLLossy(), {
        // A link opens in a new tab, as from the editor.
        ADD_ATTR: ['target'],
        RETURN_DOM_FRAGMENT: true
      })
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
    [blocks]
  )

  return (
    <Box
      ref={show}
      sx={theme => ({
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
      })}
    />
  )
}

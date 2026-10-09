import { createExtension } from '@blocknote/core'
import { createReactBlockSpec } from '@blocknote/react'
import { Box, Typography } from '@linagora/twake-mui'
import { Plugin } from 'prosemirror-state'
import { createContext, use, useId, type ReactElement } from 'react'

import { isFields, KEPT_BLOCK, storedBlock } from '@/ds/editorBlocks'

/** Names the kind of a block the editor does not write, from its type. */
export const BlockKindContext = createContext<(type: string) => string>(
  type => type
)

const textOf = (value: unknown): string =>
  typeof value === 'string' ? value : ''

/**
 * A block the editor does not write, by its kind, its caption or else its
 * name, and its address. The address shows as text, as no check of the
 * server covers that of a block it does not know.
 */
function KeptBlockView({ stored }: { stored: string }): ReactElement {
  const kindOf = use(BlockKindContext)
  const kindId = useId()
  const block = storedBlock(stored) ?? {}
  const props = isFields(block.props) ? block.props : {}
  const caption = textOf(props.caption) || textOf(props.name)
  const url = textOf(props.url)

  return (
    <Box
      role="group"
      aria-labelledby={kindId}
      // ProseMirror makes a block without content so through a property,
      // which jsdom lacks: the attribute says it in tests too.
      contentEditable={false}
      sx={theme => ({
        width: '100%',
        border: `1px solid ${theme.vars.palette.divider}`,
        borderRadius: 1,
        padding: theme.spacing(1, 1.5)
      })}
    >
      <Typography id={kindId} component="div" variant="subtitle2">
        {kindOf(textOf(block.type))}
      </Typography>
      {caption && (
        <Typography component="div" variant="body2">
          {caption}
        </Typography>
      )}
      {url && (
        <Typography
          component="div"
          variant="caption"
          color="textSecondary"
          sx={{ overflowWrap: 'anywhere' }}
        >
          {url}
        </Typography>
      )}
    </Box>
  )
}

/**
 * The kept block: a block the editor does not write, held as the page
 * stores it, in JSON, which the editor shows and does not edit. Its menu
 * offers none.
 */
export const keptBlockSpec = createReactBlockSpec(
  {
    type: KEPT_BLOCK,
    propSchema: { stored: { default: '' } },
    content: 'none'
  },
  { render: ({ block }) => <KeptBlockView stored={block.props.stored} /> }
)

/**
 * `html` without its kept blocks, the blocks under one taking its place, or
 * null if it holds none. The slice it tells of goes too, as it may start or
 * end with a block left out: ProseMirror then reads it as the HTML of
 * another app.
 */
function withoutKeptBlocks(html: string): string | null {
  const { body } = new DOMParser().parseFromString(html, 'text/html')
  const kept = body.querySelectorAll(`[data-content-type="${KEPT_BLOCK}"]`)
  if (kept.length === 0) return null
  for (const content of kept) {
    const container = content.parentElement
    const outer = container?.parentElement
    if (
      container?.dataset.nodeType === 'blockContainer' &&
      outer?.dataset.nodeType === 'blockOuter'
    ) {
      const under = container.querySelector(
        ':scope > [data-node-type="blockGroup"]'
      )
      outer.replaceWith(...(under?.children ?? []))
    } else {
      content.remove()
    }
  }
  body.querySelector('[data-pm-slice]')?.removeAttribute('data-pm-slice')
  return body.innerHTML
}

/**
 * Leaves the kept blocks out of what is pasted or dropped in the editor, so
 * that only the page it opens makes them: a kept block copied holds its
 * block in an attribute, which a page of another site or a text may hold
 * as well. A block dragged by its handle still moves: BlockNote reads the
 * blocks dragged itself, and ProseMirror drops them as read.
 */
export const pastesWithoutKeptBlocks = createExtension(() => ({
  key: 'pastesWithoutKeptBlocks',
  prosemirrorPlugins: [
    new Plugin({
      props: {
        transformPastedHTML: html => withoutKeptBlocks(html) ?? html
      }
    })
  ]
}))

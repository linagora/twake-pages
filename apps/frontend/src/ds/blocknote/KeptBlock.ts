import { createBlockSpec, createExtension } from '@blocknote/core'
import type { SxProps, Theme } from '@linagora/twake-mui'
import { Plugin } from 'prosemirror-state'

import { isFields, KEPT_BLOCK, storedBlock } from '@/ds/editorBlocks'

const textOf = (value: unknown): string =>
  typeof value === 'string' ? value : ''

// Names each card by the line of its kind, under an id of its own.
let cards = 0

/** A line of the card of a kept block. */
function line(className: string, text: string): HTMLDivElement {
  const element = document.createElement('div')
  element.className = className
  element.textContent = text
  return element
}

/**
 * A block the editor does not write, by its kind, its caption or else its
 * name, and its address. The address shows as text, as no check of the
 * server covers that of a block it does not know. Drawn with the DOM, not
 * React: BlockNote draws a React block of an editor that is not shown in a
 * root of its own, through flushSync, which does nothing while React
 * renders, where the read view draws its blocks.
 */
function keptBlockCard(
  stored: string,
  kindOf: (type: string) => string
): HTMLElement {
  const block = storedBlock(stored) ?? {}
  const props = isFields(block.props) ? block.props : {}
  const caption = textOf(props.caption) || textOf(props.name)
  const url = textOf(props.url)
  cards += 1
  const kind = line('twake-kept-block-kind', kindOf(textOf(block.type)))
  kind.id = `twake-kept-block-${String(cards)}`
  const card = document.createElement('div')
  card.className = 'twake-kept-block'
  card.setAttribute('role', 'group')
  card.setAttribute('aria-labelledby', kind.id)
  // ProseMirror makes a block without content so through a property, which
  // jsdom lacks: the attribute says it in tests too.
  card.setAttribute('contenteditable', 'false')
  card.append(kind)
  if (caption) card.append(line('twake-kept-block-caption', caption))
  if (url) card.append(line('twake-kept-block-url', url))
  return card
}

/** The styles of the cards of kept blocks, for the element that holds them. */
export const keptBlockStyles: SxProps<Theme> = {
  '& .twake-kept-block': {
    width: '100%',
    border: 1,
    borderColor: 'divider',
    borderRadius: 1,
    px: 1.5,
    py: 1
  },
  '& .twake-kept-block-kind': { typography: 'subtitle2' },
  '& .twake-kept-block-caption': { typography: 'body2' },
  '& .twake-kept-block-url': {
    typography: 'caption',
    color: 'text.secondary',
    overflowWrap: 'anywhere'
  }
}

/**
 * The kept block: a block the editor does not write, held as the page
 * stores it, in JSON, which the editor shows and does not edit. Its menu
 * offers none. `kindOf` names the kind of the block held, from its type.
 */
export const keptBlockSpec = createBlockSpec(
  {
    type: KEPT_BLOCK,
    propSchema: { stored: { default: '' } },
    content: 'none'
  },
  ({ kindOf = type => type }: { kindOf?: (type: string) => string }) => ({
    render: (block: { props: { stored: string } }) => ({
      dom: keptBlockCard(block.props.stored, kindOf)
    })
  })
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

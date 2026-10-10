import type { SxProps, Theme } from '@linagora/twake-mui'

/** What a document of Grist says, in the language of the app. */
export interface GristLabels {
  /** Names the frame of a document for screen readers. */
  frame: string
  /** The link that opens a document in Grist. */
  open: string
  /** Says that a document off the origins is not shown. */
  offOrigins: string
  /** The item of the block menu that inserts a Grist embed. */
  insert: string
  /** What the item of the block menu says of a Grist embed. */
  insertHint: string
  /** The button of a Grist embed with no address, which asks for one. */
  add: string
  /** The button that gives a Grist embed the address written. */
  embed: string
}

/** The origins of Grist the pages frame documents from, and what one says. */
export interface GristOptions {
  origins: readonly string[]
  labels: GristLabels
}

/**
 * Whether the pages frame `address`: on one of `origins`, as the backend
 * checks it, again before a frame shows it. Over http or https only, which
 * the frame-src of the app holds: the address of a blob takes the origin of
 * the page that made it.
 */
export function onGristOrigin(
  address: string,
  origins: readonly string[]
): boolean {
  let url: URL
  // As URL.parse would, which older browsers lack.
  try {
    url = new URL(address)
  } catch {
    return false
  }
  return (
    ['http:', 'https:'].includes(url.protocol) && origins.includes(url.origin)
  )
}

/**
 * The document of Grist at `address`, in a frame, with a link that opens it
 * in Grist, if it is on the origins; else what says it is not shown. Drawn
 * with the DOM, for the blocks of BlockNote (see keptBlockCard).
 */
export function gristDocument(
  address: string,
  { origins, labels }: GristOptions
): HTMLElement {
  if (!onGristOrigin(address, origins)) {
    const off = document.createElement('div')
    off.className = 'twake-grist-off'
    off.textContent = labels.offOrigins
    return off
  }
  const frame = document.createElement('iframe')
  frame.className = 'twake-grist-frame'
  frame.setAttribute('src', address)
  frame.setAttribute('title', labels.frame)
  frame.setAttribute('loading', 'lazy')
  const open = document.createElement('a')
  open.className = 'twake-grist-open'
  open.setAttribute('href', address)
  // As the links of the blocks open, out of the page.
  open.setAttribute('target', '_blank')
  open.setAttribute('rel', 'noopener noreferrer')
  open.textContent = labels.open
  const grist = document.createElement('div')
  grist.className = 'twake-grist'
  grist.append(frame, open)
  return grist
}

/** The styles of the documents of Grist, for the element that holds them. */
export const gristStyles = {
  '& .twake-grist': {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-start',
    gap: 0.5,
    width: '100%'
  },
  '& .twake-grist-frame': {
    width: '100%',
    height: 480,
    border: 1,
    borderColor: 'divider',
    borderRadius: 1
  },
  '& .twake-grist-open': { typography: 'body2' },
  '& .twake-grist-off': {
    width: '100%',
    border: 1,
    borderColor: 'divider',
    borderRadius: 1,
    px: 1.5,
    py: 1,
    typography: 'body2',
    color: 'text.secondary'
  },
  '& .twake-grist-add': {
    width: '100%',
    border: 0,
    borderRadius: 1,
    px: 1.5,
    py: 1,
    bgcolor: 'action.hover',
    color: 'text.secondary',
    typography: 'body2',
    textAlign: 'left',
    cursor: 'pointer',
    '&:hover': { bgcolor: 'action.selected' }
  }
} satisfies SxProps<Theme>

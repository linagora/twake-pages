import { z } from 'zod'
import { Refused } from '../../infra/refusals.ts'
import { storable } from '../../infra/text.ts'

// A page's blocks are BlockNote's JSON, stored as sent: the server reads them
// to check them and to keep their text, and never rewrites them.

/** Over this many bytes of JSON, blocks are refused. */
export const MAX_BLOCKS_BYTES = 2 * 1024 * 1024

/** Blocks as every body that writes them carries them, still unchecked. */
export const pageBlocks = z.array(z.record(z.string(), z.unknown()))

export type Blocks = z.infer<typeof pageBlocks>

type Fields = Record<string, unknown>

const isFields = (value: unknown): value is Fields =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isList = (value: unknown): value is unknown[] => Array.isArray(value)

// The URL parser reads an address as the browser does, which skips the spaces
// before its scheme and takes the scheme in any case.
const addressOf = (value: unknown) =>
  typeof value === 'string' ? URL.parse(value) : null

const LINK_PROTOCOLS = ['http:', 'https:', 'mailto:']

const linkAllowed = (link: Fields) => {
  const href = addressOf(link.href)
  return href !== null && LINK_PROTOCOLS.includes(href.protocol)
}

// A block's address is its `url` prop, empty until the block is given one.
const urlAllowed = (block: Fields, allowed: (url: URL) => boolean) => {
  const url = isFields(block.props) ? block.props.url : undefined
  if (url === undefined || url === '') return true
  const address = addressOf(url)
  return address !== null && allowed(address)
}

const httpsOnly = (block: Fields) =>
  urlAllowed(block, url => url.protocol === 'https:')

// The page frames a Grist embed, so only a Grist origin of the deployment may
// serve it.
const onGristOrigin = (embed: Fields, gristOrigins: readonly string[]) =>
  urlAllowed(embed, url => gristOrigins.includes(url.origin))

type Rule = (fields: Fields, gristOrigins: readonly string[]) => boolean

/** The check of each type of object the blocks hold, by its `type`. */
const RULES = new Map<string, Rule>([
  ['link', linkAllowed],
  ['image', httpsOnly],
  ['video', httpsOnly],
  ['audio', httpsOnly],
  ['file', httpsOnly],
  ['gristEmbed', onGristOrigin]
])

/** Whether the blocks pass the checks of `invalid_content` (docs/api.md). */
function blocksAllowed(
  blocks: Blocks,
  gristOrigins: readonly string[]
): boolean {
  if (Buffer.byteLength(JSON.stringify(blocks)) > MAX_BLOCKS_BYTES) {
    return false
  }
  // Every object and string of the blocks, wherever it sits: a link in a
  // table cell or in a child block is checked as one in a paragraph.
  const pending: unknown[] = [...blocks]
  while (pending.length > 0) {
    const value = pending.pop()
    if (typeof value === 'string') {
      if (!storable(value)) return false
    } else if (isList(value)) {
      for (const item of value) pending.push(item)
    } else if (isFields(value)) {
      if (!Object.keys(value).every(storable)) return false
      const rule =
        typeof value.type === 'string' ? RULES.get(value.type) : undefined
      if (rule && !rule(value, gristOrigins)) return false
      for (const field of Object.values(value)) pending.push(field)
    }
  }
  return true
}

// Styled text and the text of a link, or plain strings, which BlockNote takes
// for short and templates use.
function inlineText(content: unknown): string {
  if (typeof content === 'string') return content
  if (!isList(content)) return ''
  return content
    .map(item => {
      if (typeof item === 'string') return item
      if (!isFields(item)) return ''
      return typeof item.text === 'string'
        ? item.text
        : inlineText(item.content)
    })
    .join('')
}

function addLines(block: unknown, lines: string[]) {
  if (!isFields(block)) return
  const { content, props, children } = block
  if (isFields(content) && isList(content.rows)) {
    for (const row of content.rows) {
      const cells = isFields(row) && isList(row.cells) ? row.cells : []
      for (const cell of cells) {
        lines.push(inlineText(isFields(cell) ? cell.content : cell))
      }
    }
  } else {
    lines.push(inlineText(content))
  }
  // The caption of an image, a video, an audio block or a file.
  if (isFields(props) && typeof props.caption === 'string') {
    lines.push(props.caption)
  }
  if (isList(children)) {
    for (const child of children) addLines(child, lines)
  }
}

/** The text of the blocks, a line per block, per table cell and per caption. */
function plainText(blocks: Blocks): string {
  const lines: string[] = []
  for (const block of blocks) addLines(block, lines)
  return lines.filter(line => line.trim() !== '').join('\n')
}

/**
 * The one way in for blocks, which every write of them takes: the blocks as
 * the store keeps them, with their plain text for search and previews, or
 * `invalid_content` when they fail its checks.
 */
export function checkBlocks(
  blocks: Blocks,
  gristOrigins: readonly string[]
): { content: Blocks; text: string } {
  if (!blocksAllowed(blocks, gristOrigins)) throw new Refused('invalid_content')
  return { content: blocks, text: plainText(blocks) }
}

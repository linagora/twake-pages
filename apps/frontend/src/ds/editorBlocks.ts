import type { GristOptions } from '@/ds/grist'

type Block = Record<string, unknown>

/** The block that shows a document of Grist, or one of its pages. */
export const GRIST_EMBED = 'gristEmbed'

/**
 * The blocks the editor writes: BlockNote's but video, audio and file ones,
 * which pages cannot show until files come (ADR 012), and the Grist embed.
 */
export const EDITOR_BLOCKS = [
  'paragraph',
  'heading',
  'quote',
  'bulletListItem',
  'numberedListItem',
  'checkListItem',
  'toggleListItem',
  'codeBlock',
  'table',
  'image',
  'divider',
  GRIST_EMBED
] as const

/**
 * The block in which the editor holds a block it does not write, as a
 * video, to publish it as the page stores it.
 */
export const KEPT_BLOCK = 'keptBlock'

/** What the blocks of the pages take from the app to show. */
export interface BlockOptions {
  /** Names the kind of a block the editor does not write, from its type. */
  kindOf: (type: string) => string
  /** Where a Grist embed frames its document from, and what it says. */
  grist: GristOptions
}

const written: ReadonlySet<unknown> = new Set(EDITOR_BLOCKS)

/** An object of the blocks, such as a block or its props, unchecked. */
export const isFields = (value: unknown): value is Block =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const blocksIn = (value: unknown): Block[] =>
  Array.isArray(value) ? value.filter(isFields) : []

/**
 * `blocks` with each block of a type not `known` in a kept block, as JSON,
 * but for the blocks under it, which stay under the kept block.
 */
export function withOthersKept(
  blocks: Block[],
  known: ReadonlySet<unknown>
): Block[] {
  return blocks.map(block => {
    const children = withOthersKept(blocksIn(block.children), known)
    // Without a type, BlockNote takes a block as a paragraph.
    if (block.type === undefined || known.has(block.type)) {
      return { ...block, children }
    }
    const stored = Array.isArray(block.children)
      ? { ...block, children: [] }
      : block
    return {
      type: KEPT_BLOCK,
      props: { stored: JSON.stringify(stored) },
      children
    }
  })
}

/**
 * `blocks` as the editor opens them: a block it does not write goes in a
 * kept block, the blocks under it staying under the kept block to be
 * written.
 */
export const toEditor = (blocks: Block[]): Block[] =>
  withOthersKept(blocks, written)

/** The block a kept block holds, from its JSON, or null if it holds none. */
export function storedBlock(json: unknown): Block | null {
  if (typeof json !== 'string') return null
  try {
    const block: unknown = JSON.parse(json)
    return isFields(block) ? block : null
  } catch {
    return null
  }
}

/**
 * The blocks of the editor as the page stores them: a kept block gives back
 * the block it holds, with the blocks under it.
 */
export function fromEditor(blocks: Block[]): Block[] {
  return blocks.flatMap(block => {
    const children = fromEditor(blocksIn(block.children))
    if (block.type !== KEPT_BLOCK) return [{ ...block, children }]
    const stored = storedBlock(isFields(block.props) && block.props.stored)
    if (!stored) return []
    // A block stored without children stays so while none comes under it.
    return Array.isArray(stored.children) || children.length > 0
      ? [{ ...stored, children }]
      : [stored]
  })
}

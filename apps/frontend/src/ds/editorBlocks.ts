type Block = Record<string, unknown>

/**
 * The blocks the editor writes: BlockNote's but video, audio and file ones,
 * which pages cannot show until files come (ADR 012).
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
  'divider'
] as const

/**
 * The block in which the editor holds a block it does not write, as a video
 * or a Grist embed, to publish it as the page stores it.
 */
export const KEPT_BLOCK = 'keptBlock'

const written: ReadonlySet<unknown> = new Set(EDITOR_BLOCKS)

/** An object of the blocks, such as a block or its props, unchecked. */
export const isFields = (value: unknown): value is Block =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const blocksIn = (value: unknown): Block[] =>
  Array.isArray(value) ? value.filter(isFields) : []

/**
 * `blocks` as the editor opens them. A block it does not write goes in a
 * kept block, as JSON, but for the blocks under it, which stay under the
 * kept block to be written.
 */
export function toEditor(blocks: Block[]): Block[] {
  return blocks.map(block => {
    const children = toEditor(blocksIn(block.children))
    // Without a type, BlockNote takes a block as a paragraph.
    if (block.type === undefined || written.has(block.type)) {
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

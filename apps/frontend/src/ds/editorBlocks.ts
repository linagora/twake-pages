type Blocks = Record<string, unknown>[]

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

const written: ReadonlySet<unknown> = new Set(EDITOR_BLOCKS)

/**
 * `blocks` as the editor writes them: a block it does not write, as a video
 * stored through the API, becomes a paragraph that links to its address.
 */
export function editableBlocks(blocks: Blocks): Blocks {
  return blocks.map(block => {
    const children = Array.isArray(block.children)
      ? editableBlocks(block.children as Blocks)
      : []
    // Without a type, BlockNote takes a block as a paragraph.
    if (block.type === undefined || written.has(block.type)) {
      return { ...block, children }
    }
    return { type: 'paragraph', content: linkTo(block.props), children }
  })
}

// Named as the block named its file, if it did.
function linkTo(props: unknown) {
  const { url, name } = (props ?? {}) as { url?: unknown; name?: unknown }
  if (typeof url !== 'string' || url === '') return []
  const text = typeof name === 'string' && name !== '' ? name : url
  return [
    { type: 'link', href: url, content: [{ type: 'text', text, styles: {} }] }
  ]
}

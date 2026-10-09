import { createBlockSpec } from '@blocknote/core'

import { GRIST_EMBED } from '@/ds/editorBlocks'
import { gristDocument, type GristOptions } from '@/ds/grist'

/**
 * The Grist embed: a document of Grist, or one of its pages, by its
 * address, framed on the origins of `grist` only (see gristDocument). Drawn
 * with the DOM, as the kept block is. Until it is given an address, it shows
 * nothing.
 */
export const gristEmbedSpec = (grist: GristOptions) =>
  createBlockSpec(
    {
      type: GRIST_EMBED,
      propSchema: { url: { default: '' } },
      content: 'none'
    },
    {
      render: (block: { props: { url: string } }) => ({
        dom:
          block.props.url === ''
            ? document.createElement('div')
            : gristDocument(block.props.url, grist)
      })
    }
  )()

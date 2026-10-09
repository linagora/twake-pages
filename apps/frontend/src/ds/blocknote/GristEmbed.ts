import { createBlockSpec, type Dictionary } from '@blocknote/core'
import { FilePanelExtension } from '@blocknote/core/extensions'

import { GRIST_EMBED } from '@/ds/editorBlocks'
import { gristDocument, type GristLabels, type GristOptions } from '@/ds/grist'

/**
 * The button of a Grist embed with no address, which asks for one as that
 * of an image does: `ask` opens BlockNote's panel of files.
 */
function addButton(label: string, ask: () => void): HTMLButtonElement {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'twake-grist-add'
  button.textContent = label
  // As the button of an image: the editor keeps the focus, and ProseMirror
  // leaves the press alone.
  button.addEventListener('mousedown', event => {
    event.preventDefault()
    event.stopPropagation()
  })
  button.addEventListener('click', ask)
  return button
}

/**
 * The Grist embed: a document of Grist, or one of its pages, by its
 * address, framed on the origins of `grist` only (see gristDocument). Drawn
 * with the DOM, as the kept block is. Until it is given an address, the
 * editor asks for one, and the page shows nothing.
 */
export const gristEmbedSpec = (grist: GristOptions) =>
  createBlockSpec(
    {
      type: GRIST_EMBED,
      propSchema: { url: { default: '' } },
      content: 'none'
    },
    {
      render: (block, editor) => ({
        dom:
          block.props.url === ''
            ? addButton(grist.labels.add, () => {
                editor.getExtension(FilePanelExtension)?.showMenu(block.id)
              })
            : gristDocument(block.props.url, grist)
      }),
      toExternalHTML: block => ({
        dom:
          block.props.url === ''
            ? document.createElement('div')
            : gristDocument(block.props.url, grist)
      })
    }
  )()

/** `words` of each type of block, with `word` for a Grist embed. */
const withGrist = (words: Record<string, string>, word: string) => ({
  ...words,
  [GRIST_EMBED]: word
})

/**
 * `dictionary` with the words of BlockNote's panel of files for a Grist
 * embed, which it takes from those of a file otherwise.
 * Twake Tasks asks for the address of a link in a popover of its own, given
 * its labels as props; a Grist embed asks for its own in BlockNote's panel,
 * as an image does, and that panel takes its words from BlockNote's
 * dictionary.
 */
export function withGristWords(
  dictionary: Dictionary,
  labels: GristLabels
): Dictionary {
  const panel = dictionary.file_panel
  return {
    ...dictionary,
    file_panel: {
      ...panel,
      embed: {
        ...panel.embed,
        embed_button: withGrist(panel.embed.embed_button, labels.embed)
      }
    }
  }
}

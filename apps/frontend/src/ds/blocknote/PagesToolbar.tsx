import {
  FileDownloadButton,
  FormattingToolbar,
  getFormattingToolbarItems,
  useSelectedBlocks,
  type FormattingToolbarProps
} from '@blocknote/react'
import type { ReactElement } from 'react'

import { GRIST_EMBED } from '@/ds/editorBlocks'

/**
 * BlockNote's toolbar, but without its download button for a Grist embed:
 * the button would open the embed's address in a new tab, even off the
 * Grist origins, where the embed withholds its link; on them, the frame
 * comes with its own.
 */
export function PagesToolbar({
  blockTypeSelectItems
}: FormattingToolbarProps): ReactElement {
  const embed = useSelectedBlocks().some(block => block.type === GRIST_EMBED)

  return (
    <FormattingToolbar>
      {getFormattingToolbarItems(blockTypeSelectItems).filter(
        item => !embed || item.type !== FileDownloadButton
      )}
    </FormattingToolbar>
  )
}

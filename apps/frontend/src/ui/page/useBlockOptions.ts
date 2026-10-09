import { useMemo } from 'react'

import type { BlockOptions } from '@/ds/editorBlocks'
import { useI18n } from '@/ui/i18n/useI18n'

/**
 * What the blocks of the pages take from the app: the kind of a block the
 * editor does not write, named from its type, those the API knows by their
 * names, any other by its type.
 */
export function useBlockOptions(): BlockOptions {
  const { t } = useI18n()
  // The same while the language is: the read view draws its blocks again
  // when it changes.
  return useMemo(
    () => ({
      kindOf: type => {
        switch (type) {
          case 'video':
            return t('editor.blockKind.video')
          case 'audio':
            return t('editor.blockKind.audio')
          case 'file':
            return t('editor.blockKind.file')
          case 'gristEmbed':
            return t('editor.blockKind.gristEmbed')
          default:
            return t('editor.blockKind.other', { type })
        }
      }
    }),
    [t]
  )
}

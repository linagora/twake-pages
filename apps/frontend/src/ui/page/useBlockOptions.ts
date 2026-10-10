import { useMemo } from 'react'

import type { BlockOptions } from '@/ds/editorBlocks'
import { useGristOrigins } from '@/ui/GristOriginsProvider'
import { listed } from '@/ui/i18n/listed'
import { useI18n } from '@/ui/i18n/useI18n'

/**
 * What the blocks of the pages take from the app: the kind of a block the
 * editor does not write, named from its type, those the API knows by their
 * names, any other by its type; and the origins of Grist the pages frame
 * documents from, with what a document of Grist says, in the language of
 * the app.
 */
export function useBlockOptions(): BlockOptions {
  const origins = useGristOrigins()
  const { t, lang } = useI18n()
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
          default:
            return t('editor.blockKind.other', { type })
        }
      },
      grist: {
        origins,
        labels: {
          frame: t('grist.frame'),
          open: t('grist.open'),
          offOrigins:
            origins.length > 0
              ? t('grist.offOrigins', { origins: listed(origins, lang) })
              : t('grist.noOrigins'),
          insert: t('grist.insert'),
          insertHint: t('grist.insertHint'),
          add: t('grist.add'),
          embed: t('grist.embed'),
          replace: t('grist.replace'),
          remove: t('grist.remove')
        }
      }
    }),
    [origins, t, lang]
  )
}

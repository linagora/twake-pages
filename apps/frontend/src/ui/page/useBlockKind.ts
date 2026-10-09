import { useI18n } from '@/ui/i18n/useI18n'

/**
 * Names the kind of a block the editor does not write, from its type: those
 * the API knows by their names, any other by its type.
 */
export function useBlockKind(): (type: string) => string {
  const { t } = useI18n()
  return type => {
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
}

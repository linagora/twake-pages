import type { WikiRef } from '@/domain/wiki'
import { useI18n } from '@/ui/i18n/useI18n'

/** A wiki's name as shown: the personal wiki under a translated label. */
export function useWikiName(): (wiki: WikiRef) => string {
  const { t } = useI18n()
  return wiki => (wiki.kind === 'personal' ? t('wikis.personal') : wiki.name)
}

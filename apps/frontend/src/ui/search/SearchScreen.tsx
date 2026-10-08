import type { ReactElement } from 'react'
import { useParams } from 'react-router'

import { useI18n } from '@/ui/i18n/useI18n'
import { PlaceholderScreen } from '@/ui/PlaceholderScreen'

// Searches every wiki of the person, or the wiki of the route.
export function SearchScreen(): ReactElement {
  const { t } = useI18n()
  const { wikiId } = useParams()
  return (
    <PlaceholderScreen
      title={wikiId === undefined ? t('search.title') : t('search.inWiki')}
    />
  )
}

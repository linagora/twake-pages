import { Typography } from '@linagora/twake-mui'
import type { ReactElement } from 'react'

import { useI18n } from '@/ui/i18n/useI18n'
import { usePage } from '@/ui/wiki/queries'

/** The number of the version a page shows, below its title. */
export function PageVersion({
  wikiId,
  pageId
}: {
  wikiId: string
  pageId: string
}): ReactElement | null {
  const { t } = useI18n()
  const page = usePage(wikiId, pageId)
  if (!page.data) return null

  return (
    <Typography variant="body2" color="textSecondary">
      {t('page.version', { number: page.data.version })}
    </Typography>
  )
}

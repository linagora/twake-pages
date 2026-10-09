import { Link } from '@linagora/twake-mui'
import type { ReactElement } from 'react'
import { Link as RouterLink } from 'react-router'

import { useI18n } from '@/ui/i18n/useI18n'
import { usePage } from '@/ui/wiki/queries'

/**
 * The number of the version a page shows, below its title, which leads to
 * the page's history at `to`.
 */
export function PageVersion({
  wikiId,
  pageId,
  to
}: {
  wikiId: string
  pageId: string
  to: string
}): ReactElement | null {
  const { t } = useI18n()
  const page = usePage(wikiId, pageId)
  if (!page.data) return null

  return (
    <Link
      component={RouterLink}
      to={to}
      title={t('page.history')}
      variant="body2"
      color="textSecondary"
      underline="hover"
    >
      {t('page.version', { number: page.data.version })}
    </Link>
  )
}

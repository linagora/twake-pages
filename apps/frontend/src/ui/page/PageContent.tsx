import { Typography } from '@linagora/twake-mui'
import type { ReactElement } from 'react'

import { Blocks } from '@/ds/Blocks'
import type { Page } from '@/domain/page'
import { useI18n } from '@/ui/i18n/useI18n'

/** What a page holds, read only: now, or at one of its versions. */
export function PageContent({
  page
}: {
  page: Pick<Page, 'kind' | 'content'>
}): ReactElement | null {
  const { t } = useI18n()
  // A database page shows a Grist document, not blocks.
  if (page.kind !== 'document') return null
  if (page.content.length === 0) {
    return <Typography color="textSecondary">{t('page.empty')}</Typography>
  }
  return <Blocks blocks={page.content} loadingLabel={t('app.loading')} />
}

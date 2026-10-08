import { Typography } from '@linagora/twake-mui'
import type { ReactElement } from 'react'

import { Blocks } from '@/ds/Blocks'
import type { Page } from '@/domain/page'
import { useI18n } from '@/ui/i18n/useI18n'

/** What a page holds, read only. */
export function PageContent({ page }: { page: Page }): ReactElement | null {
  const { t } = useI18n()
  // A database page holds a Grist table, not blocks.
  if (page.kind !== 'document') return null
  if (page.content.length === 0) {
    return <Typography color="textSecondary">{t('page.empty')}</Typography>
  }
  return <Blocks blocks={page.content} />
}

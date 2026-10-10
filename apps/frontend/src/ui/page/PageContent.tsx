import { Typography } from '@linagora/twake-mui'
import type { ReactElement } from 'react'

import { Blocks } from '@/ds/Blocks'
import { GristDocumentView } from '@/ds/GristDocumentView'
import type { Page } from '@/domain/page'
import { useI18n } from '@/ui/i18n/useI18n'
import { useBlockOptions } from '@/ui/page/useBlockOptions'

/** What a page holds, read only: now, or at one of its versions. */
export function PageContent({
  page
}: {
  page: Pick<Page, 'kind' | 'content' | 'gristUrl'>
}): ReactElement | null {
  const { t } = useI18n()
  const blockOptions = useBlockOptions()
  // A database page shows a Grist document, not blocks.
  if (page.kind !== 'document') {
    return page.gristUrl === null ? null : (
      <GristDocumentView address={page.gristUrl} grist={blockOptions.grist} />
    )
  }
  if (page.content.length === 0) {
    return <Typography color="textSecondary">{t('page.empty')}</Typography>
  }
  return (
    <Blocks
      blocks={page.content}
      options={blockOptions}
      loadingLabel={t('app.loading')}
    />
  )
}

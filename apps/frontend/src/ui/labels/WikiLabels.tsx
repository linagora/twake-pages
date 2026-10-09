import { LabelOutlined } from '@linagora/twake-icons'
import { ListSubheader, Typography } from '@linagora/twake-mui'
import type { ReactElement } from 'react'

import { EmptyState, ListSkeleton } from '@/ds/EmptyState'
import { Chips } from '@/ds/SidePanel'
import { useI18n } from '@/ui/i18n/useI18n'
import { LabelLink } from '@/ui/labels/LabelLink'
import { useWikiLabels } from '@/ui/wiki/queries'

/**
 * The labels of the wiki's live pages, in its sidebar, below its pages, each
 * leading to the pages that carry it. Twake Tasks offers label names only in
 * the form of a saved filter, which then lists the tasks: a wiki lists its
 * pages by label (ADR 012), so the wiki shows its labels themselves.
 */
export function WikiLabels({ wikiId }: { wikiId: string }): ReactElement {
  const { t } = useI18n()
  const labels = useWikiLabels(wikiId)

  return (
    <>
      <ListSubheader component="div">{t('labels.list')}</ListSubheader>
      {labels.isError && (
        <Typography role="alert" className="u-ph-1">
          {t('labels.loadFailed')}
        </Typography>
      )}
      {labels.isPending && <ListSkeleton label={t('app.loading')} rows={2} />}
      {labels.isSuccess && labels.data.length === 0 && (
        <EmptyState compact icon={LabelOutlined} title={t('labels.empty')} />
      )}
      {labels.isSuccess && labels.data.length > 0 && (
        <div className="u-ph-1 u-mb-1">
          <Chips label={t('labels.list')}>
            {labels.data.map(label => (
              <li key={label.name}>
                <LabelLink
                  to={`labels/${encodeURIComponent(label.name)}`}
                  name={label.name}
                  pages={label.pages}
                />
              </li>
            ))}
          </Chips>
        </div>
      )}
    </>
  )
}

import { LabelOutlined } from '@linagora/twake-icons'
import { Link, Typography } from '@linagora/twake-mui'
import type { ReactElement } from 'react'
import { Link as RouterLink, useParams } from 'react-router'

import { EmptyState, ListSkeleton } from '@/ds/EmptyState'
import { PageHeader } from '@/ds/PageHeader'
import { Tile, TileGrid } from '@/ds/TileGrid'
import { useI18n } from '@/ui/i18n/useI18n'
import { useDocumentTitle } from '@/ui/useDocumentTitle'
import { usePagesWithLabel } from '@/ui/wiki/queries'

/**
 * The wiki's live pages that carry the label, by title, each leading to it.
 * Where Twake Tasks lists the tasks of a saved filter, which may name a
 * label, a wiki lists its pages by label (ADR 012), on a screen of their own.
 */
export function LabelScreen(): ReactElement {
  const { t } = useI18n()
  const { wikiId = '', name = '' } = useParams()
  const pages = usePagesWithLabel(wikiId, name)
  const title = t('labels.title', { name })
  useDocumentTitle(title)

  return (
    <main className="u-p-2">
      <PageHeader
        title={
          <Typography variant="h3" component="h1">
            {title}
          </Typography>
        }
      />
      {pages.isError && (
        <Typography role="alert">{t('labels.pagesLoadFailed')}</Typography>
      )}
      {pages.isPending && <ListSkeleton label={t('app.loading')} rows={3} />}
      {pages.isSuccess && pages.data.length === 0 && (
        <EmptyState icon={LabelOutlined} title={t('labels.noPages')} />
      )}
      {pages.isSuccess && pages.data.length > 0 && (
        <TileGrid label={title}>
          {pages.data.map(page => (
            <Tile key={page.id}>
              <Link
                component={RouterLink}
                to={`../pages/${page.id}`}
                underline="none"
                color="textPrimary"
              >
                {page.title}
              </Link>
            </Tile>
          ))}
        </TileGrid>
      )}
    </main>
  )
}

import { Library } from '@linagora/twake-icons'
import { Typography } from '@linagora/twake-mui'
import type { ReactElement } from 'react'

import { EmptyState, ListSkeleton } from '@/ds/EmptyState'
import { Tile, TileGrid } from '@/ds/TileGrid'
import { useI18n } from '@/ui/i18n/useI18n'
import { useDocumentTitle } from '@/ui/useDocumentTitle'
import { useWikis } from '@/ui/wiki/queries'

export function HomeScreen(): ReactElement {
  const { t } = useI18n()
  const wikis = useWikis()
  useDocumentTitle(null)

  return (
    <main className="u-p-2">
      <Typography variant="h3" component="h1" className="u-mb-2">
        {t('app.name')}
      </Typography>
      {wikis.isError && (
        <Typography role="alert">{t('wikis.loadFailed')}</Typography>
      )}
      {wikis.isPending && <ListSkeleton label={t('app.loading')} rows={3} />}
      {wikis.isSuccess && wikis.data.length === 0 && (
        <EmptyState
          icon={Library}
          title={t('wikis.empty')}
          text={t('wikis.emptyHint')}
        />
      )}
      {wikis.isSuccess && wikis.data.length > 0 && (
        <TileGrid label={t('wikis.title')}>
          {wikis.data.map(wiki => (
            <Tile key={wiki.id}>
              <Typography>{wiki.name}</Typography>
            </Tile>
          ))}
        </TileGrid>
      )}
    </main>
  )
}

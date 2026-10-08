import { Icon, Library, Plus } from '@linagora/twake-icons'
import { Button, Link, Typography } from '@linagora/twake-mui'
import { useState, type ReactElement } from 'react'
import { Link as RouterLink, useNavigate } from 'react-router'

import { EmptyState, ListSkeleton } from '@/ds/EmptyState'
import { PageHeader } from '@/ds/PageHeader'
import { Tile, TileGrid } from '@/ds/TileGrid'
import type { Wiki } from '@/domain/wiki'
import { useI18n } from '@/ui/i18n/useI18n'
import { useDocumentTitle } from '@/ui/useDocumentTitle'
import { useCreateWiki, useWikis } from '@/ui/wiki/queries'
import { useWikiName } from '@/ui/wiki/useWikiName'
import { WikiDialog } from '@/ui/wiki/WikiDialog'

export function HomeScreen(): ReactElement {
  const { t } = useI18n()
  const navigate = useNavigate()
  const wikis = useWikis()
  const wikiName = useWikiName()
  const [creating, setCreating] = useState(false)
  useDocumentTitle(null)

  return (
    <main className="u-p-2">
      <PageHeader
        title={
          <Typography variant="h3" component="h1">
            {t('app.name')}
          </Typography>
        }
        actions={
          <Button
            startIcon={<Icon icon={Plus} />}
            onClick={() => {
              setCreating(true)
            }}
          >
            {t('wikis.new')}
          </Button>
        }
      />
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
              <Link
                component={RouterLink}
                to={`/wikis/${wiki.id}`}
                underline="none"
                color="textPrimary"
              >
                {wikiName(wiki)}
              </Link>
            </Tile>
          ))}
        </TileGrid>
      )}
      {creating && (
        <NewWikiDialog
          onClose={() => {
            setCreating(false)
          }}
          onCreated={wiki => {
            void navigate(`/wikis/${wiki.id}`)
          }}
        />
      )}
    </main>
  )
}

function NewWikiDialog({
  onClose,
  onCreated
}: {
  onClose: () => void
  onCreated: (wiki: Wiki) => void
}): ReactElement {
  const { t } = useI18n()
  const create = useCreateWiki()
  return (
    <WikiDialog
      title={t('newWiki.title')}
      submit={t('newWiki.create')}
      change={create}
      onSaved={onCreated}
      onClose={onClose}
    />
  )
}

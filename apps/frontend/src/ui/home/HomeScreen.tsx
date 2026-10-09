import { Icon, Library, Plus } from '@linagora/twake-icons'
import { Button, Link, Typography } from '@linagora/twake-mui'
import { useState, type ReactElement } from 'react'
import { Link as RouterLink, useNavigate } from 'react-router'

import { EmptyState, ListSkeleton } from '@/ds/EmptyState'
import { PageHeader } from '@/ds/PageHeader'
import { CardTile, Shelves, Tile, TileGrid, TileShelf } from '@/ds/TileGrid'
import type { PageRef } from '@/domain/page'
import type { Wiki } from '@/domain/wiki'
import { useI18n } from '@/ui/i18n/useI18n'
import { useDocumentTitle } from '@/ui/useDocumentTitle'
import {
  useCreateWiki,
  useFavorites,
  useRecent,
  useWikis
} from '@/ui/wiki/queries'
import { usePageEntry, type PageEntry } from '@/ui/wiki/usePageEntry'
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
      <PageShelves />
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

/**
 * The person's favorites and recent pages, shelved as Twake Tasks shelves its
 * boards, an empty shelf left out as its favorites are. They wait for the
 * wikis, which tell their home pages. A list that fails to load says so in
 * place of its shelf, as the wikis do.
 */
function PageShelves(): ReactElement | null {
  const { t } = useI18n()
  const entryOf = usePageEntry()
  const favorites = useFavorites()
  const recent = useRecent()
  if (!entryOf) return null
  const shelves = [
    {
      name: t('home.favorites'),
      list: favorites,
      loadFailed: t('home.favoritesLoadFailed')
    },
    {
      name: t('home.recent'),
      list: recent,
      loadFailed: t('home.recentLoadFailed')
    }
  ].filter(({ list }) => list.isError || (list.data?.length ?? 0) > 0)
  if (shelves.length === 0) return null
  return (
    <div className="u-mb-1-half">
      <Shelves>
        {shelves.map(({ name, list, loadFailed }) =>
          list.isError ? (
            <Typography key={name} role="alert">
              {loadFailed}
            </Typography>
          ) : (
            <PageShelf
              key={name}
              name={name}
              pages={list.data ?? []}
              entryOf={entryOf}
            />
          )
        )}
      </Shelves>
    </div>
  )
}

function PageShelf({
  name,
  pages,
  entryOf
}: {
  name: string
  pages: PageRef[]
  entryOf: (page: PageRef) => PageEntry
}): ReactElement {
  return (
    <TileShelf name={name}>
      {pages.map(page => {
        const { title, path, place } = entryOf(page)
        return (
          <CardTile
            key={page.id}
            label={title}
            badge={(Array.from(title)[0] ?? '').toUpperCase()}
            title={
              <Link component={RouterLink} to={path}>
                {title}
              </Link>
            }
            meta={place}
          />
        )
      })}
    </TileShelf>
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

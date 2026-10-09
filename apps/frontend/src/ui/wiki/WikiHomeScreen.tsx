import { Icon, Plus, Share } from '@linagora/twake-icons'
import { Button, Typography } from '@linagora/twake-mui'
import { useState, type ReactElement } from 'react'
import { useNavigate, useParams } from 'react-router'

import { ListSkeleton } from '@/ds/EmptyState'
import { PageHeader } from '@/ds/PageHeader'
import { useI18n } from '@/ui/i18n/useI18n'
import { EditAction } from '@/ui/page/EditAction'
import { FavoriteButton } from '@/ui/page/FavoriteButton'
import { NewPageDialog } from '@/ui/page/NewPageDialog'
import { PageContent } from '@/ui/page/PageContent'
import { PageVersion } from '@/ui/page/PageVersion'
import { useDocumentTitle } from '@/ui/useDocumentTitle'
import { usePage, useWiki } from '@/ui/wiki/queries'
import { ShareWikiDialog } from '@/ui/wiki/ShareWikiDialog'
import { useWikiName } from '@/ui/wiki/useWikiName'
import { WikiMenu } from '@/ui/wiki/WikiMenu'

export function WikiHomeScreen(): ReactElement {
  const { t } = useI18n()
  const navigate = useNavigate()
  const { wikiId = '' } = useParams()
  const wiki = useWiki(wikiId)
  const wikiName = useWikiName()
  const name = wiki.data ? wikiName(wiki.data) : null
  const [creating, setCreating] = useState(false)
  const [sharing, setSharing] = useState(false)
  useDocumentTitle(name)

  return (
    <main className="u-p-2">
      {wiki.data && (
        <>
          <PageHeader
            title={
              <>
                <Typography variant="h3" component="h1" noWrap>
                  {name}
                </Typography>
                {/* Saved as typed: a description of blanks only says none. */}
                {wiki.data.description.trim() !== '' && (
                  <Typography variant="body2" color="textSecondary">
                    {wiki.data.description}
                  </Typography>
                )}
                <PageVersion
                  wikiId={wikiId}
                  pageId={wiki.data.homePageId}
                  to={`pages/${wiki.data.homePageId}/history`}
                />
              </>
            }
            actions={
              <>
                <EditAction
                  wikiId={wikiId}
                  pageId={wiki.data.homePageId}
                  to={`pages/${wiki.data.homePageId}/edit`}
                />
                <HomePageFavorite
                  wikiId={wikiId}
                  pageId={wiki.data.homePageId}
                />
                {wiki.data.role === 'admin' && wiki.data.kind === 'shared' && (
                  <Button
                    variant="secondary"
                    startIcon={<Icon icon={Share} />}
                    onClick={() => {
                      setSharing(true)
                    }}
                  >
                    {t('sharing.share')}
                  </Button>
                )}
                {wiki.data.role !== 'viewer' && (
                  <>
                    <Button
                      startIcon={<Icon icon={Plus} />}
                      onClick={() => {
                        setCreating(true)
                      }}
                    >
                      {t('newPage.title')}
                    </Button>
                    {wiki.data.role === 'admin' && (
                      <WikiMenu wiki={wiki.data} />
                    )}
                  </>
                )}
              </>
            }
          />
          <HomePage wikiId={wikiId} pageId={wiki.data.homePageId} />
          {sharing && (
            <ShareWikiDialog
              wiki={wiki.data}
              onClose={() => {
                setSharing(false)
              }}
            />
          )}
        </>
      )}
      {creating && (
        <NewPageDialog
          wikiId={wikiId}
          onClose={() => {
            setCreating(false)
          }}
          onCreated={page => {
            void navigate(`pages/${page.id}`)
          }}
        />
      )}
    </main>
  )
}

// Under the name of the wiki, not its own title.
function HomePage({
  wikiId,
  pageId
}: {
  wikiId: string
  pageId: string
}): ReactElement {
  const { t } = useI18n()
  const page = usePage(wikiId, pageId)
  if (page.data) return <PageContent page={page.data} />
  if (page.isError) {
    return <Typography role="alert">{t('page.loadFailed')}</Typography>
  }
  return <ListSkeleton label={t('app.loading')} rows={2} />
}

/**
 * Any member keeps favorites, viewers too, so the home page's button shows
 * apart from the editors' actions. It reads the page through the query the
 * page below reads, which fetches it once: one visit.
 */
function HomePageFavorite({
  wikiId,
  pageId
}: {
  wikiId: string
  pageId: string
}): ReactElement | null {
  const page = usePage(wikiId, pageId)
  return page.data ? <FavoriteButton page={page.data} /> : null
}

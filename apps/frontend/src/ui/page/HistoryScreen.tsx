import { Icon, Left } from '@linagora/twake-icons'
import { Button, Link, Typography } from '@linagora/twake-mui'
import type { ReactElement } from 'react'
import { Link as RouterLink, useParams } from 'react-router'

import { ListSkeleton } from '@/ds/EmptyState'
import { PageHeader } from '@/ds/PageHeader'
import { Feed, FeedItem } from '@/ds/SidePanel'
import { useI18n } from '@/ui/i18n/useI18n'
import { useWikiPage } from '@/ui/page/useWikiPage'
import { VersionByline } from '@/ui/page/VersionByline'
import { PersonAvatar } from '@/ui/people/PersonAvatar'
import { UnavailableScreen } from '@/ui/shell/Problems'
import { useDocumentTitle } from '@/ui/useDocumentTitle'
import { pathInItsWiki } from '@/ui/wiki/pathInItsWiki'
import { useHistory, useWiki } from '@/ui/wiki/queries'
import { useWikiName } from '@/ui/wiki/useWikiName'

/** The versions of a page, newest first. */
export function HistoryScreen(): ReactElement {
  const { t } = useI18n()
  const { wikiId = '', pageId = '' } = useParams()
  const { page, missing } = useWikiPage(wikiId, pageId)
  const wiki = useWiki(wikiId)
  const wikiName = useWikiName()
  const shown = missing ? undefined : page.data
  // The home page shows under the name of its wiki, read by now, as its
  // layout waits for it.
  const name = shown?.home && wiki.data ? wikiName(wiki.data) : shown?.title
  const title = name === undefined ? null : t('history.title', { title: name })
  useDocumentTitle(title)

  if (!shown) {
    return (
      <UnavailableScreen
        query={page}
        missing={missing}
        notFound={t('page.notFound')}
        loadFailed={t('page.loadFailed')}
      />
    )
  }

  return (
    <main className="u-p-2">
      <PageHeader
        back={
          <Button
            component={RouterLink}
            to={pathInItsWiki(shown, shown.home)}
            variant="secondary"
            startIcon={<Icon icon={Left} />}
          >
            {t('history.back')}
          </Button>
        }
        title={
          <Typography variant="h3" component="h1">
            {title}
          </Typography>
        }
      />
      <Versions wikiId={wikiId} pageId={pageId} />
    </main>
  )
}

/**
 * As Twake Tasks lists the changes of a task, newest first, by whom and
 * when. Its history shows in a panel beside the task, while this one is a
 * screen of its own, which shows placeholders while it loads.
 */
function Versions({
  wikiId,
  pageId
}: {
  wikiId: string
  pageId: string
}): ReactElement {
  const { t } = useI18n()
  const history = useHistory(wikiId, pageId)

  if (history.isError) {
    return <Typography role="alert">{t('history.loadFailed')}</Typography>
  }
  if (!history.data) return <ListSkeleton label={t('app.loading')} />
  return (
    <Feed label={t('history.versions')}>
      {history.data.map(version => (
        <FeedItem
          key={version.number}
          avatar={
            <PersonAvatar
              email={version.author.email}
              name={version.author.name}
            />
          }
        >
          <Typography variant="body2">
            <Link
              component={RouterLink}
              to={String(version.number)}
              underline="hover"
            >
              {t('page.version', { number: version.number })}
            </Link>
            {` · ${version.title}`}
          </Typography>
          <VersionByline version={version} />
        </FeedItem>
      ))}
    </Feed>
  )
}

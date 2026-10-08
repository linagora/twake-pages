import { Typography } from '@linagora/twake-mui'
import type { ReactElement } from 'react'
import { useParams } from 'react-router'

import { ListSkeleton } from '@/ds/EmptyState'
import { PageHeader } from '@/ds/PageHeader'
import { useI18n } from '@/ui/i18n/useI18n'
import { PageContent } from '@/ui/page/PageContent'
import { useDocumentTitle } from '@/ui/useDocumentTitle'
import { usePage, useWiki } from '@/ui/wiki/queries'
import { useWikiName } from '@/ui/wiki/useWikiName'

export function WikiHomeScreen(): ReactElement {
  const { wikiId = '' } = useParams()
  const wiki = useWiki(wikiId)
  const wikiName = useWikiName()
  const name = wiki.data ? wikiName(wiki.data) : null
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
                {wiki.data.description && (
                  <Typography variant="body2" color="textSecondary">
                    {wiki.data.description}
                  </Typography>
                )}
              </>
            }
          />
          <HomePage wikiId={wikiId} pageId={wiki.data.homePageId} />
        </>
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

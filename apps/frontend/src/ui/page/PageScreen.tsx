import { Breadcrumbs, Link, Typography } from '@linagora/twake-mui'
import type { ReactElement } from 'react'
import { Link as RouterLink, useParams } from 'react-router'

import { PageHeader } from '@/ds/PageHeader'
import type { Page } from '@/domain/page'
import { useI18n } from '@/ui/i18n/useI18n'
import { PageLabels } from '@/ui/labels/PageLabels'
import { EditAction } from '@/ui/page/EditAction'
import { FavoriteButton } from '@/ui/page/FavoriteButton'
import { PageContent } from '@/ui/page/PageContent'
import { PageMenu } from '@/ui/page/PageMenu'
import { PageVersion } from '@/ui/page/PageVersion'
import { TrashNotice } from '@/ui/page/TrashNotice'
import { useWikiPage } from '@/ui/page/useWikiPage'
import { UnavailableScreen } from '@/ui/shell/Problems'
import { useDocumentTitle } from '@/ui/useDocumentTitle'
import { historyInItsWiki } from '@/ui/wiki/pathInItsWiki'
import { useWiki } from '@/ui/wiki/queries'
import { useWikiName } from '@/ui/wiki/useWikiName'

export function PageScreen(): ReactElement {
  const { t } = useI18n()
  const { wikiId = '', pageId = '' } = useParams()
  const { page, missing } = useWikiPage(wikiId, pageId)
  useDocumentTitle(missing ? null : (page.data?.title ?? null))

  if (missing || !page.data) {
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
        back={<PagePath ancestors={page.data.ancestors} />}
        title={
          <>
            <Typography variant="h3" component="h1">
              {page.data.title}
            </Typography>
            <PageVersion
              wikiId={wikiId}
              pageId={pageId}
              to={historyInItsWiki(page.data)}
            />
            <PageLabels page={page.data} />
          </>
        }
        actions={
          <>
            <EditAction wikiId={wikiId} pageId={pageId} to="edit" />
            <FavoriteButton page={page.data} />
            <PageMenu page={page.data} />
          </>
        }
      />
      {/* The page stays readable, sent to the trash while open or opened
          from it. */}
      {page.data.deletedAt !== null && <TrashNotice page={page.data} />}
      <PageContent page={page.data} />
    </main>
  )
}

/** The pages above this one, from the home page of the wiki down. */
function PagePath({
  ancestors
}: {
  ancestors: Page['ancestors']
}): ReactElement {
  const { t } = useI18n()
  const { wikiId = '' } = useParams()
  const wiki = useWiki(wikiId)
  const wikiName = useWikiName()
  return (
    <Breadcrumbs aria-label={t('page.path')}>
      {/* The home page shows under the name of its wiki. */}
      <Link component={RouterLink} to=".." underline="hover" color="inherit">
        {wiki.data ? wikiName(wiki.data) : t('wiki.home')}
      </Link>
      {ancestors.map(ancestor => (
        <Link
          key={ancestor.id}
          component={RouterLink}
          to={`../pages/${ancestor.id}`}
          underline="hover"
          color="inherit"
        >
          {ancestor.title}
        </Link>
      ))}
    </Breadcrumbs>
  )
}

import { Compass } from '@linagora/twake-icons'
import { Alert, Breadcrumbs, Link, Typography } from '@linagora/twake-mui'
import type { ReactElement } from 'react'
import { Link as RouterLink, useParams } from 'react-router'

import { ApiError } from '@/application/pages'
import { EmptyState, ListSkeleton } from '@/ds/EmptyState'
import { PageHeader } from '@/ds/PageHeader'
import type { Page } from '@/domain/page'
import { useI18n } from '@/ui/i18n/useI18n'
import { PageContent } from '@/ui/page/PageContent'
import { useDocumentTitle } from '@/ui/useDocumentTitle'
import { usePage, useWiki } from '@/ui/wiki/queries'
import { useWikiName } from '@/ui/wiki/useWikiName'

export function PageScreen(): ReactElement {
  const { t } = useI18n()
  const { wikiId = '', pageId = '' } = useParams()
  const page = usePage(wikiId, pageId)
  // Checked before the data, which a failed reload keeps. A page of another
  // wiki has no place in this one's tree.
  const missing =
    (page.error instanceof ApiError && page.error.status === 404) ||
    (page.data !== undefined && page.data.wikiId !== wikiId)
  useDocumentTitle(missing ? null : (page.data?.title ?? null))

  if (missing || !page.data) {
    return (
      <main className="u-p-2">
        {missing && (
          <EmptyState
            icon={Compass}
            title={t('page.notFound')}
            text={t('problems.notFoundHint')}
          />
        )}
        {page.isError && !missing && (
          <Typography role="alert">{t('page.loadFailed')}</Typography>
        )}
        {page.isPending && <ListSkeleton label={t('app.loading')} />}
      </main>
    )
  }

  return (
    <main className="u-p-2">
      <PageHeader
        back={<PagePath ancestors={page.data.ancestors} />}
        title={
          <Typography variant="h3" component="h1">
            {page.data.title}
          </Typography>
        }
      />
      {/* As Twake Tasks tells of an archived board. The page stays readable,
          sent to the trash while open or opened from it. */}
      {page.data.deletedAt !== null && (
        <Alert severity="info" className="u-mb-1">
          {t('page.inTrash')}
        </Alert>
      )}
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

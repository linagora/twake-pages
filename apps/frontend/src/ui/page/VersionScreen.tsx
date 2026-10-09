import { Icon, Left } from '@linagora/twake-icons'
import { Button, Typography } from '@linagora/twake-mui'
import type { ReactElement } from 'react'
import { Link as RouterLink, useParams } from 'react-router'

import { ApiError } from '@/application/pages'
import { PageHeader } from '@/ds/PageHeader'
import { useI18n } from '@/ui/i18n/useI18n'
import { PageContent } from '@/ui/page/PageContent'
import { useWikiPage } from '@/ui/page/useWikiPage'
import { VersionByline } from '@/ui/page/VersionByline'
import { UnavailableScreen } from '@/ui/shell/Problems'
import { useDocumentTitle } from '@/ui/useDocumentTitle'
import { historyInItsWiki } from '@/ui/wiki/pathInItsWiki'
import { useVersion } from '@/ui/wiki/queries'

/** The backend keeps a version's number in a column of 32-bit integers. */
const MAX_VERSION_NUMBER = 2 ** 31 - 1

/**
 * The number of a version in the address, read as the backend reads it:
 * digits with no leading zero, up to the integers of its column. Other text
 * names no version, though `Number` reads `01` or `1e0` as 1.
 */
function versionNumberOf(text: string): number | null {
  if (!/^[1-9]\d*$/.test(text)) return null
  const number = Number(text)
  return number <= MAX_VERSION_NUMBER ? number : null
}

/**
 * A version of a page, read only, as it was published, which Twake Tasks
 * has no counterpart of: it keeps the changes made to a task, not the task
 * as it was.
 */
export function VersionScreen(): ReactElement {
  const { t } = useI18n()
  const { wikiId = '', pageId = '', number = '' } = useParams()
  const { page, missing } = useWikiPage(wikiId, pageId)
  const versionNumber = versionNumberOf(number)
  const version = useVersion(wikiId, pageId, versionNumber)
  // Checked before the data, which a failed reload keeps.
  const versionMissing =
    versionNumber === null ||
    (version.error instanceof ApiError && version.error.status === 404)
  const shown = missing ? undefined : page.data
  const shownVersion = versionMissing ? undefined : version.data
  const title =
    shown && shownVersion
      ? t('version.title', {
          title: shownVersion.title,
          number: shownVersion.number
        })
      : null
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
  if (!shownVersion) {
    return (
      <UnavailableScreen
        query={version}
        missing={versionMissing}
        notFound={t('version.notFound')}
        loadFailed={t('version.loadFailed')}
      />
    )
  }

  return (
    <main className="u-p-2">
      <PageHeader
        back={
          <Button
            component={RouterLink}
            to={historyInItsWiki(shown)}
            variant="secondary"
            startIcon={<Icon icon={Left} />}
          >
            {t('version.back')}
          </Button>
        }
        title={
          <>
            <Typography variant="h3" component="h1">
              {title}
            </Typography>
            <VersionByline version={shownVersion} />
          </>
        }
      />
      <PageContent page={{ kind: shown.kind, content: shownVersion.content }} />
    </main>
  )
}

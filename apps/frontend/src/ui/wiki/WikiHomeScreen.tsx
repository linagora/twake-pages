import { Typography } from '@linagora/twake-mui'
import type { ReactElement } from 'react'
import { useParams } from 'react-router'

import { PageHeader } from '@/ds/PageHeader'
import { useDocumentTitle } from '@/ui/useDocumentTitle'
import { useWiki } from '@/ui/wiki/queries'
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
      )}
    </main>
  )
}

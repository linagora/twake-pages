import { Magnifier } from '@linagora/twake-icons'
import { Link, Typography } from '@linagora/twake-mui'
import type { UseQueryResult } from '@tanstack/react-query'
import type { ReactElement } from 'react'
import { Link as RouterLink, useParams, useSearchParams } from 'react-router'

import { EmptyState, ListSkeleton } from '@/ds/EmptyState'
import { Highlight } from '@/ds/Highlight'
import { ResultList, ResultRow } from '@/ds/ResultList'
import type { PageRef } from '@/domain/page'
import { excerptParts, type SearchResult } from '@/domain/search'
import { useI18n } from '@/ui/i18n/useI18n'
import { PlaceholderScreen } from '@/ui/PlaceholderScreen'
import { useDocumentTitle } from '@/ui/useDocumentTitle'
import { useSearch } from '@/ui/wiki/queries'
import { usePageEntry, type PageEntry } from '@/ui/wiki/usePageEntry'

export function SearchScreen(): ReactElement {
  const { t } = useI18n()
  const { wikiId } = useParams()
  if (wikiId !== undefined) {
    return <PlaceholderScreen title={t('search.inWiki')} />
  }
  return <AppSearchScreen />
}

/** The search of every wiki of the person. */
function AppSearchScreen(): ReactElement {
  const { t } = useI18n()
  const [params] = useSearchParams()
  const text = params.get('q')?.trim() ?? ''
  const results = useSearch(text)
  const entryOf = usePageEntry()
  useDocumentTitle(t('search.title'))

  return (
    <main className="u-p-2">
      <Typography variant="h3" component="h1" className="u-mb-2">
        {t('search.title')}
      </Typography>
      <Outcome text={text} results={results} entryOf={entryOf} />
    </main>
  )
}

/** The pages found for `text`, or why none shows; nothing before a search. */
function Outcome({
  text,
  results,
  entryOf
}: {
  text: string
  results: UseQueryResult<SearchResult[]>
  /** How a page found shows, once known. */
  entryOf: ((page: PageRef) => PageEntry) | undefined
}): ReactElement | null {
  const { t } = useI18n()
  if (results.isError) {
    return <Typography role="alert">{t('search.failed')}</Typography>
  }
  if (text === '') return null
  if (!results.data || !entryOf) {
    return <ListSkeleton label={t('app.loading')} />
  }
  if (results.data.length === 0) {
    return (
      <EmptyState
        icon={Magnifier}
        title={t('search.empty')}
        text={t('search.emptyHint')}
      />
    )
  }
  return <Results text={text} results={results.data} entryOf={entryOf} />
}

function Results({
  text,
  results,
  entryOf
}: {
  text: string
  results: SearchResult[]
  entryOf: (page: PageRef) => PageEntry
}): ReactElement {
  const { t } = useI18n()
  return (
    <ResultList label={t('search.results', { text })} count={results.length}>
      {results.map(({ page, markedTitle, excerpt }) => {
        const { title, path, place } = entryOf(page)
        // A home page shows under its wiki's name, which the backend marks
        // only where it is the page's own title.
        const ownTitle = title === page.title
        return (
          <ResultRow
            key={page.id}
            label={title}
            title={
              <Link component={RouterLink} to={path}>
                {ownTitle ? (
                  <Highlight parts={excerptParts(markedTitle)} />
                ) : (
                  title
                )}
              </Link>
            }
            excerpt={
              excerpt !== '' && <Highlight parts={excerptParts(excerpt)} />
            }
            place={place}
          />
        )
      })}
    </ResultList>
  )
}

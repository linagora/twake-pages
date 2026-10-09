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
import { SearchField } from '@/ui/search/SearchField'
import { useDocumentTitle } from '@/ui/useDocumentTitle'
import { useSearch, useWikiSearch } from '@/ui/wiki/queries'
import {
  usePageEntry,
  type PageEntry,
  type PathOf
} from '@/ui/wiki/usePageEntry'

/** The search of every wiki of the person, or of the wiki of the address. */
export function SearchScreen(): ReactElement {
  const { t } = useI18n()
  const { wikiId } = useParams()
  const [params] = useSearchParams()
  const text = params.get('q')?.trim() ?? ''
  const title = t(wikiId === undefined ? 'search.title' : 'search.inWiki')
  useDocumentTitle(title)

  return (
    <main className="u-p-2">
      <Typography variant="h3" component="h1" className="u-mb-2">
        {title}
      </Typography>
      {wikiId === undefined ? (
        <AppSearch text={text} />
      ) : (
        <WikiSearch wikiId={wikiId} text={text} />
      )}
    </main>
  )
}

/** The search of every wiki, whose field is in the app bar. */
function AppSearch({ text }: { text: string }): ReactElement {
  const results = useSearch(text)
  const entryOf = usePageEntry()
  return <Outcome text={text} results={results} entryOf={entryOf} />
}

/**
 * The path to a page found from its wiki's own screen, which keeps to the
 * frame of TwakeSpace, where the wiki's address would leave it.
 */
const pathInItsWiki: PathOf = (page, home) =>
  home ? '..' : `../pages/${page.id}`

/**
 * The search of one wiki. It has a field of its own, as TwakeSpace shows the
 * wiki without the app bar, and its results open inside the frame of
 * TwakeSpace too.
 */
function WikiSearch({
  wikiId,
  text
}: {
  wikiId: string
  text: string
}): ReactElement {
  const { t } = useI18n()
  const [, setParams] = useSearchParams()
  const results = useWikiSearch(wikiId, text)
  const entryOf = usePageEntry(pathInItsWiki)
  return (
    <>
      <div className="u-mb-2 u-maw-7">
        <SearchField
          label={t('search.inWiki')}
          searched={text}
          onSearch={words => {
            setParams({ q: words })
          }}
        />
      </div>
      <Outcome text={text} results={results} entryOf={entryOf} />
    </>
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

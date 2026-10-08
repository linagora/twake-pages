import { useQuery, type UseQueryResult } from '@tanstack/react-query'

import type { Tree } from '@/application/pages'
import type { Page } from '@/domain/page'
import type { Wiki, WikiSummary } from '@/domain/wiki'
import { usePagesApi } from '@/ui/PagesApiProvider'

export const wikisKey = ['wikis']
// What is shown of a wiki sits below its key, to reload it all at once.
const wikiKey = (wikiId: string) => ['wikis', wikiId] as const

export function useWikis(): UseQueryResult<WikiSummary[]> {
  const api = usePagesApi()
  return useQuery({ queryKey: wikisKey, queryFn: api.listWikis })
}

export function useWiki(wikiId: string): UseQueryResult<Wiki> {
  const api = usePagesApi()
  return useQuery({
    queryKey: wikiKey(wikiId),
    queryFn: () => api.getWiki(wikiId)
  })
}

export function useTree(wikiId: string): UseQueryResult<Tree> {
  const api = usePagesApi()
  return useQuery({
    queryKey: [...wikiKey(wikiId), 'tree'],
    queryFn: () => api.getTree(wikiId)
  })
}

/** A page as shown below a wiki, which may not be its own. */
export function usePage(wikiId: string, pageId: string): UseQueryResult<Page> {
  const api = usePagesApi()
  return useQuery({
    queryKey: [...wikiKey(wikiId), 'pages', pageId],
    queryFn: () => api.getPage(pageId)
  })
}

import { useQuery, type UseQueryResult } from '@tanstack/react-query'

import type { Wiki, WikiSummary } from '@/domain/wiki'
import { usePagesApi } from '@/ui/PagesApiProvider'

export const wikisKey = ['wikis']
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

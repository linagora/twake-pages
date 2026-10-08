import { useQuery, type UseQueryResult } from '@tanstack/react-query'

import type { WikiSummary } from '@/domain/wiki'
import { usePagesApi } from '@/ui/PagesApiProvider'

export const wikisKey = ['wikis']

export function useWikis(): UseQueryResult<WikiSummary[]> {
  const api = usePagesApi()
  return useQuery({ queryKey: wikisKey, queryFn: api.listWikis })
}

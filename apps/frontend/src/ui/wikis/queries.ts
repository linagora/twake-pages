import { useQuery, type UseQueryResult } from '@tanstack/react-query'

import type { Wiki } from '@/application/pages'
import { usePagesApi } from '@/ui/PagesApiProvider'

export const wikisKey = ['wikis']

export function useWikis(): UseQueryResult<Wiki[]> {
  const api = usePagesApi()
  return useQuery({ queryKey: wikisKey, queryFn: api.listWikis })
}

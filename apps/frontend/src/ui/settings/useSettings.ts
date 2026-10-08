import { useQuery, type UseQueryResult } from '@tanstack/react-query'

import type { UserSettings } from '@/application/pages'
import { usePagesApi } from '@/ui/PagesApiProvider'

export const settingsKey = ['settings']

export function useSettings(): UseQueryResult<UserSettings> {
  const api = usePagesApi()
  return useQuery({
    queryKey: settingsKey,
    queryFn: api.settings,
    retry: false,
    staleTime: Infinity
  })
}

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult
} from '@tanstack/react-query'
import { useEffect } from 'react'

import type { NewWiki, Tree } from '@/application/pages'
import type { Page } from '@/domain/page'
import type { Wiki, WikiSummary } from '@/domain/wiki'
import { usePagesApi } from '@/ui/PagesApiProvider'

export const wikisKey = ['wikis']
// What is shown of a wiki sits below its key, to reload it all at once.
const wikiKey = (wikiId: string) => ['wikis', wikiId] as const
const treeKey = (wikiId: string) => [...wikiKey(wikiId), 'tree'] as const

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

export function useCreateWiki(): UseMutationResult<Wiki, Error, NewWiki> {
  const api = usePagesApi()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (wiki: NewWiki) => api.createWiki(wiki),
    onSuccess: wiki => {
      queryClient.setQueryData(wikiKey(wiki.id), wiki)
      return queryClient.invalidateQueries({ queryKey: wikisKey, exact: true })
    }
  })
}

/**
 * Reloads what is shown of the wiki on a newer version: a change made
 * elsewhere, or one missed while the stream was reconnecting. Called once
 * for the open wiki, where Twake Tasks watches in useBoard: a wiki shows in
 * several queries, each of which would open its own stream.
 */
export function useLiveWiki(wikiId: string): void {
  const api = usePagesApi()
  const queryClient = useQueryClient()
  useEffect(
    () =>
      api.watchWiki(wikiId, version => {
        // The wiki and its tree are read apart, each at its own version: the
        // older one tells what may be missing.
        const shown = [
          queryClient.getQueryData<Wiki>(wikiKey(wikiId))?.version,
          queryClient.getQueryData<Tree>(treeKey(wikiId))?.version
        ].filter(read => read !== undefined)
        if (shown.length > 0 && version > Math.min(...shown)) {
          void queryClient.invalidateQueries({ queryKey: wikiKey(wikiId) })
        }
      }),
    [api, queryClient, wikiId]
  )
}

export function useTree(wikiId: string): UseQueryResult<Tree> {
  const api = usePagesApi()
  return useQuery({
    queryKey: treeKey(wikiId),
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

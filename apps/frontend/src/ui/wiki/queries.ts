import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
  type UseMutationResult,
  type UseQueryResult
} from '@tanstack/react-query'
import { useEffect } from 'react'

import type { NewWiki, Tree, WikiChanges } from '@/application/pages'
import type { Page } from '@/domain/page'
import type { Wiki, WikiSummary } from '@/domain/wiki'
import { usePagesApi } from '@/ui/PagesApiProvider'

export const wikisKey = ['wikis']
// What is shown of a wiki sits below its key, to reload it all at once.
const wikiKey = (wikiId: string) => ['wikis', wikiId] as const
const treeKey = (wikiId: string) => [...wikiKey(wikiId), 'tree'] as const
const pagesKey = (wikiId: string) => [...wikiKey(wikiId), 'pages'] as const

/**
 * A page carries no version of its wiki, so it keeps the one known as its
 * read began: never newer than the page, so a change the read missed still
 * reloads it.
 */
interface ReadPage {
  page: Page
  version: number | undefined
}

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

// The answer is the wiki as it now is, which the list shows by name.
function showWiki(queryClient: QueryClient, wiki: Wiki): Promise<void> {
  queryClient.setQueryData(wikiKey(wiki.id), wiki)
  return queryClient.invalidateQueries({ queryKey: wikisKey, exact: true })
}

export function useCreateWiki(): UseMutationResult<Wiki, Error, NewWiki> {
  const api = usePagesApi()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (wiki: NewWiki) => api.createWiki(wiki),
    onSuccess: wiki => showWiki(queryClient, wiki)
  })
}

export function useEditWiki(
  wikiId: string
): UseMutationResult<Wiki, Error, WikiChanges> {
  const api = usePagesApi()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (changes: WikiChanges) => api.renameWiki(wikiId, changes),
    onSuccess: wiki => showWiki(queryClient, wiki)
  })
}

export function useDeleteWiki(
  wikiId: string
): UseMutationResult<void, Error, void> {
  const api = usePagesApi()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => api.deleteWiki(wikiId),
    onSuccess: () => {
      // The home screen the admin lands on lists it no more, even before
      // the list is read again.
      queryClient.setQueryData<WikiSummary[]>(wikisKey, shown =>
        shown?.filter(wiki => wiki.id !== wikiId)
      )
      return queryClient.invalidateQueries({ queryKey: wikisKey, exact: true })
    }
  })
}

/**
 * Reloads what is shown of the wiki on a newer version: a change made
 * elsewhere, or one missed while the stream was reconnecting. Called once
 * for the open wiki, where Twake Tasks watches in useBoard: a wiki shows in
 * several queries, each of which would open its own stream.
 *
 * Unlike Twake Tasks, it stops `watching` a wiki out of reach, whose stream
 * would answer not_found again on each reconnection.
 */
export function useLiveWiki(wikiId: string, watching: boolean): void {
  const api = usePagesApi()
  const queryClient = useQueryClient()
  useEffect(() => {
    if (!watching) return
    return api.watchWiki(wikiId, version => {
      // The wiki, its tree and its open pages are read apart, each at its own
      // version: the oldest tells what may be missing.
      const shown = [
        queryClient.getQueryData<Wiki>(wikiKey(wikiId))?.version,
        queryClient.getQueryData<Tree>(treeKey(wikiId))?.version,
        ...queryClient
          .getQueriesData<ReadPage>({
            queryKey: pagesKey(wikiId),
            type: 'active'
          })
          .map(([, read]) => read?.version)
      ].filter(read => read !== undefined)
      if (shown.length > 0 && version > Math.min(...shown)) {
        void queryClient.invalidateQueries({ queryKey: wikiKey(wikiId) })
      }
    })
  }, [api, queryClient, wikiId, watching])
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
  const queryClient = useQueryClient()
  return useQuery({
    queryKey: [...pagesKey(wikiId), pageId],
    queryFn: async (): Promise<ReadPage> => {
      const version = queryClient.getQueryData<Wiki>(wikiKey(wikiId))?.version
      return { page: await api.getPage(pageId), version }
    },
    select: read => read.page
  })
}

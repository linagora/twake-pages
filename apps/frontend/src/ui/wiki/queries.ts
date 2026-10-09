import {
  keepPreviousData,
  skipToken,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
  type UseMutationResult,
  type UseQueryResult
} from '@tanstack/react-query'
import { useEffect } from 'react'

import type {
  Label,
  LabelledPage,
  Move,
  NewPage,
  NewVersion,
  NewWiki,
  PagesApi,
  PersonMatch,
  RecentPage,
  Sharing,
  Tree,
  WikiChanges
} from '@/application/pages'
import type {
  Page,
  PageRef,
  TrashEntry,
  Version,
  VersionSummary
} from '@/domain/page'
import type { SearchResult } from '@/domain/search'
import type { Member, Wiki, WikiSummary } from '@/domain/wiki'
import { usePagesApi } from '@/ui/PagesApiProvider'
import { useSession } from '@/ui/session/SessionGate'

export const wikisKey = ['wikis']
const favoritesKey = ['favorites']
const recentKey = ['recent']
// The search of every wiki follows no wiki's stream, so it sits below no
// wiki's key.
const searchKey = (text: string) => ['search', text] as const
// What is shown of a wiki sits below its key, to reload it all at once.
const wikiKey = (wikiId: string) => ['wikis', wikiId] as const
const treeKey = (wikiId: string) => [...wikiKey(wikiId), 'tree'] as const
const pagesKey = (wikiId: string) => [...wikiKey(wikiId), 'pages'] as const
const pageKey = (wikiId: string, pageId: string) =>
  [...pagesKey(wikiId), pageId] as const
const wikiSearchKey = (wikiId: string, text: string) =>
  [...wikiKey(wikiId), 'search', text] as const
const labelsKey = (wikiId: string) => [...wikiKey(wikiId), 'labels'] as const
const trashKey = (wikiId: string) => [...wikiKey(wikiId), 'trash'] as const
// Unlike Twake Tasks, which keeps a task's history below the task, a page's
// history is not below the pages' key: useLiveWiki takes every query there
// for a read page, with its version of the wiki.
const historyKey = (wikiId: string, pageId: string) =>
  [...wikiKey(wikiId), 'history', pageId] as const
const versionKey = (wikiId: string, pageId: string, number: number | null) =>
  [...historyKey(wikiId, pageId), number] as const
// Below the wiki, so a change of its members elsewhere reloads them too.
const sharingKey = (wikiId: string) => [...wikiKey(wikiId), 'sharing'] as const
// The people of an organization belong to no wiki, so they sit below no
// wiki's key.
const peopleKey = (text: string) => ['people', text] as const
// What the backend takes as a search of people.
const LONGEST_PEOPLE_SEARCH = 200

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

export function useFavorites(): UseQueryResult<PageRef[]> {
  const api = usePagesApi()
  return useQuery({ queryKey: favoritesKey, queryFn: api.favorites })
}

export function useRecent(): UseQueryResult<RecentPage[]> {
  const api = usePagesApi()
  return useQuery({ queryKey: recentKey, queryFn: api.recent })
}

/**
 * The pages found for `text` in every wiki of the person, the best first. A
 * blank text searches nothing, as in Twake Tasks.
 */
export function useSearch(text: string): UseQueryResult<SearchResult[]> {
  const api = usePagesApi()
  return useQuery({
    queryKey: searchKey(text),
    queryFn: () => api.search(text),
    enabled: text.trim() !== ''
  })
}

/**
 * The pages of `wikiId` found for `text`, the best first, found again with
 * the rest of the wiki when its stream tells of a change.
 */
export function useWikiSearch(
  wikiId: string,
  text: string
): UseQueryResult<SearchResult[]> {
  const api = usePagesApi()
  return useQuery({
    queryKey: wikiSearchKey(wikiId, text),
    queryFn: () => api.search(text, wikiId),
    enabled: text.trim() !== ''
  })
}

// `enabled` false holds the wiki back until it may be found.
export function useWiki(
  wikiId: string,
  { enabled = true }: { enabled?: boolean } = {}
): UseQueryResult<Wiki> {
  const api = usePagesApi()
  return useQuery({
    queryKey: wikiKey(wikiId),
    queryFn: () => api.getWiki(wikiId),
    enabled
  })
}

// The answer is the wiki as it now is, which the list shows by name.
function cacheWikiAndInvalidateList(
  queryClient: QueryClient,
  wiki: Wiki
): Promise<void> {
  queryClient.setQueryData(wikiKey(wiki.id), wiki)
  return queryClient.invalidateQueries({ queryKey: wikisKey, exact: true })
}

export function useCreateWiki(): UseMutationResult<Wiki, Error, NewWiki> {
  const api = usePagesApi()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (wiki: NewWiki) => api.createWiki(wiki),
    onSuccess: wiki => cacheWikiAndInvalidateList(queryClient, wiki)
  })
}

/** Changes the name of a shared wiki only: the dialog of another shows none. */
export function useEditWiki(
  wiki: Wiki
): UseMutationResult<Wiki, Error, Required<WikiChanges>> {
  const api = usePagesApi()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ name, description }: Required<WikiChanges>) =>
      api.renameWiki(
        wiki.id,
        wiki.kind === 'shared' ? { name, description } : { description }
      ),
    onSuccess: edited => cacheWikiAndInvalidateList(queryClient, edited)
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

/** The members of the wiki, and its invitations for an admin. */
export function useSharing(wikiId: string): UseQueryResult<Sharing> {
  const api = usePagesApi()
  return useQuery({
    queryKey: sharingKey(wikiId),
    queryFn: () => api.getMembers(wikiId)
  })
}

/**
 * After a change of the wiki's members, they are read again, with the wiki
 * and the role it gives the person, as Twake Tasks' useBoardChange reads the
 * board again: refused or not, since a refusal may come from a list behind
 * the wiki.
 */
const reloadSharing = (queryClient: QueryClient, wikiId: string) =>
  Promise.all([
    queryClient.invalidateQueries({ queryKey: wikiKey(wikiId), exact: true }),
    queryClient.invalidateQueries({ queryKey: sharingKey(wikiId) })
  ])

/**
 * Changes the wiki's members or invitations, each change made through the
 * API it is given.
 */
export function useSharingChange(
  wikiId: string
): UseMutationResult<void, Error, (api: PagesApi) => Promise<void>> {
  const api = usePagesApi()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (change: (api: PagesApi) => Promise<void>) => change(api),
    onSettled: () => reloadSharing(queryClient, wikiId)
  })
}

/**
 * Takes the member out of the wiki. The person who takes themself out goes
 * where `onLeft` leads, with their wikis listing it no more, as after
 * deleting it: from here, not from the callbacks given to mutate, since the
 * stream may tell the wiki is out of reach before the answer does, and the
 * screen it closes would drop them. Unlike Twake Tasks, which leaves the
 * person on the board they left.
 */
export function useRemoveMember(
  wikiId: string,
  onLeft: () => void
): UseMutationResult<void, Error, Member> {
  const api = usePagesApi()
  const queryClient = useQueryClient()
  const { user } = useSession()
  return useMutation({
    mutationFn: (member: Member) => api.removeMember(wikiId, member.id),
    onSuccess: (_answer, member) => {
      if (member.email.toLowerCase() !== user.email?.toLowerCase()) return
      queryClient.setQueryData<WikiSummary[]>(wikisKey, shown =>
        shown?.filter(wiki => wiki.id !== wikiId)
      )
      onLeft()
      return queryClient.invalidateQueries({ queryKey: wikisKey, exact: true })
    },
    onSettled: () => reloadSharing(queryClient, wikiId)
  })
}

/**
 * The people of the person's organization whose email or name holds what was
 * typed, none in B2C. Those found last stay until the next search answers,
 * so the suggestions do not blink as the person types.
 */
export function usePeopleMatching(
  typed: string
): UseQueryResult<PersonMatch[]> {
  const api = usePagesApi()
  const text = typed.trim()
  return useQuery({
    queryKey: peopleKey(text),
    queryFn: () => api.searchPeople(text),
    enabled: text !== '' && text.length <= LONGEST_PEOPLE_SEARCH,
    placeholderData: keepPreviousData
  })
}

export function useTree(wikiId: string): UseQueryResult<Tree> {
  const api = usePagesApi()
  return useQuery({
    queryKey: treeKey(wikiId),
    queryFn: () => api.getTree(wikiId)
  })
}

/**
 * The tree is read again before the caller opens the new page, as Twake
 * Tasks reads a board again once a task is added to it.
 */
export function useCreatePage(
  wikiId: string
): UseMutationResult<Page, Error, NewPage> {
  const api = usePagesApi()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (page: NewPage) => api.createPage(wikiId, page),
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: treeKey(wikiId) })
  })
}

/**
 * The wiki is read again before the move ends: the tree, and the path of an
 * open page, which moves with its ancestors. The move answers whether the
 * tree shows it, which it does not when the tree could not be read again.
 * Unlike Twake Tasks, which moves a task on its board before the answer, the
 * page waits for its place, whose key the backend makes.
 */
export function useMovePage(
  wikiId: string
): UseMutationResult<boolean, Error, { pageId: string; move: Move }> {
  const api = usePagesApi()
  const queryClient = useQueryClient()
  const reload = () =>
    queryClient.invalidateQueries({ queryKey: wikiKey(wikiId) })
  return useMutation({
    mutationFn: async ({ pageId, move }: { pageId: string; move: Move }) => {
      await api.movePage(pageId, move)
      await reload()
      return queryClient.getQueryState(treeKey(wikiId))?.status !== 'error'
    },
    // A refused move may come from a tree behind the wiki.
    onError: reload
  })
}

/**
 * Makes the change through the API it is given, then reads the wiki again,
 * refused or not, as Twake Tasks' useBoardChange reads its board again: a
 * refusal may come from a wiki shown behind it.
 */
function useWikiChange<T>(
  wikiId: string,
  change: (api: PagesApi, input: T) => Promise<unknown>
): UseMutationResult<unknown, Error, T> {
  const api = usePagesApi()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: T) => change(api, input),
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: wikiKey(wikiId) })
  })
}

/**
 * `onDeleted` runs once the page is in the trash, even when the stream told
 * of it first and the screen that deleted it is gone, and before the wiki is
 * read again: the person leaves the page rather than see it in the trash.
 */
export function useDeletePage(
  page: Page,
  onDeleted: () => void
): UseMutationResult<unknown, Error, void> {
  return useWikiChange(page.wikiId, async api => {
    await api.deletePage(page.id)
    onDeleted()
  })
}

/** The wiki's deleted branches, newest first, read again with the wiki. */
export function useTrash(wikiId: string): UseQueryResult<TrashEntry[]> {
  const api = usePagesApi()
  return useQuery({
    queryKey: trashKey(wikiId),
    queryFn: () => api.listTrash(wikiId)
  })
}

/**
 * The wiki, read again once the restore ends, shows the branch back in the
 * tree, and the page at its new place.
 */
export function useRestorePage(
  wikiId: string
): UseMutationResult<unknown, Error, string> {
  return useWikiChange(wikiId, (api, pageId: string) => api.restorePage(pageId))
}

/** A page as shown below a wiki, which may not be its own. */
export function usePage(wikiId: string, pageId: string): UseQueryResult<Page> {
  const api = usePagesApi()
  const queryClient = useQueryClient()
  return useQuery({
    queryKey: pageKey(wikiId, pageId),
    queryFn: async (): Promise<ReadPage> => {
      const version = queryClient.getQueryData<Wiki>(wikiKey(wikiId))?.version
      return { page: await api.getPage(pageId), version }
    },
    select: read => read.page
  })
}

/**
 * The page shown changes in place: reading it again would count as a visit.
 * The favorites are read again, as Twake Tasks reads its boards again, but
 * only once the change went through: a refused one leaves them as they were.
 */
export function useSetFavorite(
  page: Page
): UseMutationResult<void, Error, boolean> {
  const api = usePagesApi()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (favorite: boolean) => api.setFavorite(page.id, favorite),
    onSuccess: (_answer, favorite) => {
      queryClient.setQueryData<ReadPage>(
        pageKey(page.wikiId, page.id),
        read => read && { ...read, page: { ...read.page, favorite } }
      )
      return queryClient.invalidateQueries({
        queryKey: favoritesKey,
        exact: true
      })
    }
  })
}

// The answer is the page at its new version, which the tree shows by title.
function cachePageAndInvalidateTree(
  queryClient: QueryClient,
  wikiId: string,
  page: Page
): Promise<void> {
  // At the version of the wiki its last read knew, older than the one
  // publishing moved it to.
  queryClient.setQueryData<ReadPage>(pageKey(wikiId, page.id), read => ({
    page,
    version: read?.version
  }))
  return queryClient.invalidateQueries({ queryKey: treeKey(wikiId) })
}

/**
 * The page shows its new version as soon as it is published, and the tree
 * its title once read again, before the caller opens the page.
 * `onPublished` runs once the version is published, though the screen that
 * published it is gone.
 */
export function usePublish(
  wikiId: string,
  pageId: string,
  onPublished: () => void
): UseMutationResult<Page, Error, NewVersion> {
  const api = usePagesApi()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (version: NewVersion) => api.publish(pageId, version),
    onSuccess: page => {
      onPublished()
      return cachePageAndInvalidateTree(queryClient, wikiId, page)
    }
  })
}

export function useWikiLabels(wikiId: string): UseQueryResult<Label[]> {
  const api = usePagesApi()
  return useQuery({
    queryKey: labelsKey(wikiId),
    queryFn: () => api.listLabels(wikiId)
  })
}

/** Read again with the wiki's labels, once a page's labels change. */
export function usePagesWithLabel(
  wikiId: string,
  name: string
): UseQueryResult<LabelledPage[]> {
  const api = usePagesApi()
  return useQuery({
    queryKey: [...labelsKey(wikiId), name],
    queryFn: () => api.pagesWithLabel(wikiId, name)
  })
}

/**
 * The page shows the labels it carries in place, as it shows a favorite, and
 * what is shown of the wiki's labels is read again once the change went
 * through. Twake Tasks reads its whole board again instead, even after a
 * refused change: here reading the page again would count as a visit.
 */
export function useSetLabels(
  page: Page
): UseMutationResult<string[], Error, string[]> {
  const api = usePagesApi()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (names: string[]) => api.setLabels(page.id, names),
    onSuccess: labels => {
      queryClient.setQueryData<ReadPage>(
        pageKey(page.wikiId, page.id),
        read => read && { ...read, page: { ...read.page, labels } }
      )
      return queryClient.invalidateQueries({
        queryKey: labelsKey(page.wikiId)
      })
    }
  })
}

/** The versions of a page, newest first. */
export function useHistory(
  wikiId: string,
  pageId: string
): UseQueryResult<VersionSummary[]> {
  const api = usePagesApi()
  return useQuery({
    queryKey: historyKey(wikiId, pageId),
    queryFn: () => api.listVersions(pageId)
  })
}

/**
 * A version of a page, with its title and content as it was published. A
 * null `number` names no version, and none is asked for.
 */
export function useVersion(
  wikiId: string,
  pageId: string,
  number: number | null
): UseQueryResult<Version> {
  const api = usePagesApi()
  return useQuery({
    queryKey: versionKey(wikiId, pageId, number),
    queryFn: number === null ? skipToken : () => api.getVersion(pageId, number)
  })
}

/**
 * The page shows the version restored as its newest, and the tree its title
 * once read again, before `onRestored` runs. It runs though the screen that
 * restored the version is gone, as the person asked for the page as it was.
 */
export function useRestoreVersion(
  wikiId: string,
  pageId: string,
  onRestored: () => void
): UseMutationResult<Page, Error, number> {
  const api = usePagesApi()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (number: number) => api.restoreVersion(pageId, number),
    onSuccess: async page => {
      await cachePageAndInvalidateTree(queryClient, wikiId, page)
      onRestored()
    }
  })
}

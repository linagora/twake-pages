import type { UseQueryResult } from '@tanstack/react-query'

import { ApiError } from '@/application/pages'
import type { Page } from '@/domain/page'
import { usePage } from '@/ui/wiki/queries'

/**
 * A page shown below a wiki, `missing` when it is not found. Checked before
 * the data, which a failed reload keeps. A page of another wiki has no place
 * in this one's tree.
 */
export function useWikiPage(
  wikiId: string,
  pageId: string
): { page: UseQueryResult<Page>; missing: boolean } {
  const page = usePage(wikiId, pageId)
  const missing =
    (page.error instanceof ApiError && page.error.status === 404) ||
    (page.data !== undefined && page.data.wikiId !== wikiId)
  return { page, missing }
}

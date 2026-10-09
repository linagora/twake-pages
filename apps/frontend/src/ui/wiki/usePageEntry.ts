import type { PageRef } from '@/domain/page'
import { useI18n } from '@/ui/i18n/useI18n'
import { useWikis } from '@/ui/wiki/queries'
import { useWikiName } from '@/ui/wiki/useWikiName'

/** A page listed away from its wiki's tree. */
export interface PageEntry {
  title: string
  path: string
  /** Its wiki's name, or for a home page, which shows under it, "Home page". */
  place: string
}

/**
 * The entry of a page listed away from its wiki's tree, once the person's
 * wikis, which tell their home pages, are loaded. A wiki opens on its home
 * page, which shows under the wiki's name.
 */
export function usePageEntry(): ((page: PageRef) => PageEntry) | undefined {
  const { t } = useI18n()
  const wikiName = useWikiName()
  const wikis = useWikis()
  if (wikis.isPending) return undefined
  const homePageIds = new Set(wikis.data?.map(wiki => wiki.homePageId))
  return page => {
    const home = homePageIds.has(page.id)
    const wikiPath = `/wikis/${page.wiki.id}`
    return {
      title: home ? wikiName(page.wiki) : page.title,
      path: home ? wikiPath : `${wikiPath}/pages/${page.id}`,
      place: home ? t('wiki.home') : wikiName(page.wiki)
    }
  }
}

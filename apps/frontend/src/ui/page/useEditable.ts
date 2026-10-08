import { usePage, useWiki } from '@/ui/wiki/queries'

/**
 * Whether the person writes the page in the editor: an editor of the wiki
 * does, but for a page in the trash, which takes no new version, and a
 * database, which shows a Grist document instead of blocks. Not until the
 * wiki and the page are read.
 */
export function useEditable(wikiId: string, pageId: string): boolean {
  const wiki = useWiki(wikiId)
  const page = usePage(wikiId, pageId)
  return (
    wiki.data !== undefined &&
    wiki.data.role !== 'viewer' &&
    page.data?.kind === 'document' &&
    page.data.deletedAt === null
  )
}

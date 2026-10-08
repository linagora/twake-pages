import { eq, isNull } from 'drizzle-orm'
import type { Tx } from '../../infra/db.ts'
import { accessibleWikis } from '../wikis/access.ts'
import { wikis } from '../wikis/schema.ts'
import { pages } from './schema.ts'

/**
 * The live pages of the wikis the person can open, with their wiki, for the
 * lists that show pages across wikis.
 */
export function reachablePages(tx: Tx, userId: string) {
  const accessible = accessibleWikis(tx, userId)
  return tx
    .select({
      id: pages.id,
      title: pages.title,
      wikiId: pages.wikiId,
      wikiName: wikis.name,
      wikiKind: wikis.kind
    })
    .from(pages)
    .innerJoin(accessible, eq(accessible.wikiId, pages.wikiId))
    .innerJoin(wikis, eq(wikis.id, pages.wikiId))
    .where(isNull(pages.deletedAt))
    .as('reachable')
}

/** The `PageRef` of the contract, for a page of `reachablePages`. */
export function pageRefOf(reachable: ReturnType<typeof reachablePages>) {
  return {
    id: reachable.id,
    title: reachable.title,
    wiki: {
      id: reachable.wikiId,
      name: reachable.wikiName,
      kind: reachable.wikiKind
    }
  }
}

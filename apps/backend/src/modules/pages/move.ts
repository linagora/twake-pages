import { eq } from 'drizzle-orm'
import type { Db, Tx } from '../../infra/db.ts'
import { positionBetween } from '../../infra/order.ts'
import { Refused, writeOrRefuse } from '../../infra/refusals.ts'
import type { Identity } from '../auth/index.ts'
import { checkRole } from '../wikis/access.ts'
import { bumpWiki } from '../wikis/live.ts'
import { pages } from './schema.ts'
import {
  ancestorsOf,
  checkParent,
  siblingsUnder,
  type PageMove
} from './store.ts'

async function pageAt(tx: Tx, pageId: string) {
  const [page] = await tx
    .select({
      id: pages.id,
      wikiId: pages.wikiId,
      home: pages.home,
      deletedAt: pages.deletedAt
    })
    .from(pages)
    .where(eq(pages.id, pageId))
  return page
}

export function createMoveStore(db: Db) {
  return {
    /** The page goes with its child pages, which keep their places under it. */
    movePage(identity: Identity, pageId: string, move: PageMove) {
      return writeOrRefuse(db, identity, async tx => {
        const found = await pageAt(tx, pageId)
        if (!found) throw new Refused('not_found')
        await checkRole(tx, identity, found.wikiId, 'editor')
        await bumpWiki(tx, found.wikiId)
        // Read again behind the wiki's row lock, as the changes before this
        // one left it: of two moves at the same time, the later sees the
        // earlier, so they never make a page its own ancestor.
        const page = await pageAt(tx, pageId)
        if (!page) throw new Refused('not_found')
        if (page.deletedAt !== null) throw new Refused('in_trash')
        if (page.home) throw new Refused('home_page')
        if (move.parentId !== null) {
          await checkParent(tx, page.wikiId, move.parentId)
          const ancestors = await ancestorsOf(tx, move.parentId)
          if (ancestors.some(({ id }) => id === page.id)) {
            throw new Refused('invalid_parent')
          }
        }
        // The client names the neighbours it sees once the page is lifted out.
        const siblings = (
          await siblingsUnder(tx, page.wikiId, move.parentId)
        ).filter(({ id }) => id !== page.id)
        const position = positionBetween(siblings, move.afterId, move.beforeId)
        await tx
          .update(pages)
          .set({ parentId: move.parentId, position })
          .where(eq(pages.id, page.id))
        return { parentId: move.parentId, position }
      })
    }
  }
}

import { eq } from 'drizzle-orm'
import type { Db } from '../../infra/db.ts'
import { positionBetween } from '../../infra/order.ts'
import { Refused, writeOrRefuse } from '../../infra/refusals.ts'
import type { Identity } from '../auth/index.ts'
import { queuePageEvent } from './events.ts'
import { pages } from './schema.ts'
import {
  ancestorsOf,
  checkParent,
  pageToChange,
  siblingsUnder,
  type PageMove
} from './store.ts'

export function createMoveStore(db: Db) {
  return {
    /** The page goes with its child pages, which keep their places under it. */
    movePage(identity: Identity, pageId: string, move: PageMove) {
      return writeOrRefuse(db, identity, async tx => {
        // Read behind the wiki's row lock: of two moves at the same time, the
        // later sees the earlier, so they never make a page its own ancestor.
        const page = await pageToChange(tx, identity, pageId)
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
        // As Twake Tasks tells of a task moved to another section only.
        if (page.parentId !== move.parentId) {
          await queuePageEvent(tx, identity, 'moved', page, {
            from: page.parentId,
            to: move.parentId
          })
        }
        return { parentId: move.parentId, position }
      })
    }
  }
}

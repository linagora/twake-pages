import { Typography } from '@linagora/twake-mui'
import type { ReactElement } from 'react'

import { moveInto } from '@/application/movePage'
import type { Refusal } from '@/application/pages'
import type { TreePlace } from '@/ds/treeMoves'
import { failureKey } from '@/ui/failureKey'
import { useI18n, type I18nApi, type TranslationKey } from '@/ui/i18n/useI18n'
import { useMovePage } from '@/ui/wiki/queries'

interface Titled {
  id: string
  title: string
}

/** Whether the tree shows a move, and what screen readers are to hear of it. */
interface Moved {
  shown: boolean
  said: string
}

// Unlike Twake Tasks, which says only that a move failed: a member meets
// these in plain use, as another changes the tree or their role meanwhile,
// and can do something about them.
const REFUSALS: Partial<Record<Refusal, TranslationKey>> = {
  stale_neighbours: 'movePage.treeChanged',
  invalid_parent: 'movePage.treeChanged',
  in_trash: 'movePage.treeChanged',
  not_found: 'movePage.treeChanged',
  forbidden: 'movePage.forbidden'
}

/**
 * Moves a page of the wiki, from the tree or from the menu of the page. The
 * caller says where it went with `MoveStatus`, once nothing hides it, and
 * why it did not with `failure`, once the last move failed.
 */
export function useMoveTo(wikiId: string): {
  move: ReturnType<typeof useMovePage>
  moveTo: (page: Titled, to: TreePlace<Titled>) => Promise<Moved>
  failure: string | null
} {
  const { t } = useI18n()
  const move = useMovePage(wikiId)
  return {
    move,
    moveTo: async (page, to) => {
      const ids = to.siblings.map(sibling => sibling.id)
      const shown = await move.mutateAsync({
        pageId: page.id,
        move: moveInto(to.parent?.id ?? null, ids, to.index)
      })
      return {
        shown,
        said: moveAnnouncement(t, page.title, to, {
          under: 'movePage.under',
          toTop: 'movePage.toTop'
        })
      }
    },
    failure: move.error
      ? t(failureKey(move.error, REFUSALS, 'movePage.failed'))
      : null
  }
}

/** What screen readers hear of the last move. */
export function MoveStatus({ said }: { said: string }): ReactElement {
  return (
    <Typography role="status" className="u-visuallyhidden">
      {said}
    </Typography>
  )
}

/**
 * A sentence a screen reader hears of the place a page goes to, in `words`:
 * its new parent, or the top of the tree, and its place among its siblings.
 */
export function moveAnnouncement(
  t: I18nApi['t'],
  title: string,
  to: TreePlace<{ title: string }>,
  words: { under: TranslationKey; toTop: TranslationKey }
): string {
  const place = {
    title,
    position: to.index + 1,
    count: to.siblings.length + 1
  }
  return to.parent
    ? t(words.under, { ...place, parent: to.parent.title })
    : t(words.toTop, place)
}

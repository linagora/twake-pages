import { Typography } from '@linagora/twake-mui'
import type { ReactElement } from 'react'

import { moveInto } from '@/application/movePage'
import type { TreePlace } from '@/ds/Tree'
import { useI18n, type I18nApi } from '@/ui/i18n/useI18n'
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

/**
 * Moves a page of the wiki, from the tree or from the menu of the page. The
 * caller says where it went with `MoveStatus`, once nothing hides it.
 */
export function useMoveTo(wikiId: string): {
  move: ReturnType<typeof useMovePage>
  moveTo: (page: Titled, to: TreePlace<Titled>) => Promise<Moved>
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
      return { shown, said: moveAnnouncement(t, page.title, to) }
    }
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
 * The sentence a screen reader hears once a page moved: its new parent, or
 * the top of the tree, and its place among its siblings.
 */
function moveAnnouncement(
  t: I18nApi['t'],
  title: string,
  to: TreePlace<{ title: string }>
): string {
  const place = {
    title,
    position: to.index + 1,
    count: to.siblings.length + 1
  }
  return to.parent
    ? t('movePage.under', { ...place, parent: to.parent.title })
    : t('movePage.toTop', place)
}

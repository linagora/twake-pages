import { Icon, Star, StarOutline } from '@linagora/twake-icons'
import { IconButton } from '@linagora/twake-mui'
import type { ReactElement } from 'react'

import type { Page } from '@/domain/page'
import { useI18n } from '@/ui/i18n/useI18n'
import { useSetFavorite } from '@/ui/wiki/queries'

/**
 * Adds the page to the person's favorites or takes it out, as Twake Tasks
 * does a board, and does nothing while the backend answers. Unlike Tasks'
 * small button in a board's tile, it takes the size of the menu beside it in
 * the header. Nor does it give the focus back as Tasks does: it stays where
 * it is, where Tasks' list moves the board.
 */
export function FavoriteButton({ page }: { page: Page }): ReactElement {
  const { t } = useI18n()
  const setFavorite = useSetFavorite(page)
  return (
    <IconButton
      color={page.favorite ? 'warning' : 'default'}
      aria-label={t(page.favorite ? 'page.unfavorite' : 'page.favorite')}
      onClick={() => {
        if (setFavorite.isPending) return
        setFavorite.mutate(!page.favorite)
      }}
    >
      <Icon icon={page.favorite ? Star : StarOutline} />
    </IconButton>
  )
}

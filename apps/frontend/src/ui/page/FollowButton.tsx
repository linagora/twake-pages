import { Bell, Check, Icon } from '@linagora/twake-icons'
import { Button, Tooltip } from '@linagora/twake-mui'
import type { ReactElement } from 'react'

import type { Page } from '@/domain/page'
import { useI18n } from '@/ui/i18n/useI18n'
import { useSetFollowing } from '@/ui/wiki/queries'

/**
 * Follows the page or stops, as Twake Tasks follows a task, and does nothing
 * while the backend answers, as the favorite beside it. Unlike Tasks' button,
 * which shows the change while it is made, it shows what the backend
 * answered, as the favorite does, and it takes the size of the header's
 * buttons, where Tasks' is small in a task's panel.
 */
export function FollowButton({ page }: { page: Page }): ReactElement {
  const { t } = useI18n()
  const setFollowing = useSetFollowing(page)
  return (
    <Tooltip
      title={page.following ? t('following.unfollow') : ''}
      describeChild
    >
      <Button
        variant={page.following ? 'primary' : 'secondary'}
        startIcon={<Icon icon={page.following ? Check : Bell} />}
        onClick={() => {
          if (setFollowing.isPending) return
          setFollowing.mutate(!page.following)
        }}
      >
        {t(page.following ? 'following.following' : 'following.follow')}
      </Button>
    </Tooltip>
  )
}

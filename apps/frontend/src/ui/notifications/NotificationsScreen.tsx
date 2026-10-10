import { Bell, CircleFilled, Icon } from '@linagora/twake-icons'
import { Button, Link, Typography } from '@linagora/twake-mui'
import type { ReactElement } from 'react'
import { Link as RouterLink } from 'react-router'

import { EmptyState, ListSkeleton } from '@/ds/EmptyState'
import { PageHeader } from '@/ds/PageHeader'
import { Feed, FeedItem } from '@/ds/SidePanel'
import type { Notification } from '@/domain/notification'
import { displayName } from '@/domain/person'
import { useI18n } from '@/ui/i18n/useI18n'
import { PersonAvatar } from '@/ui/people/PersonAvatar'
import { localTime } from '@/ui/settings/zone'
import { useDocumentTitle } from '@/ui/useDocumentTitle'
import { useMarkRead, useNotifications } from '@/ui/wiki/queries'
import { usePageEntry } from '@/ui/wiki/usePageEntry'
import { useWikiName } from '@/ui/wiki/useWikiName'

/**
 * The person's notifications, newest first: what happened, on which page of
 * which wiki, by whom and when, the unread ones told apart. Unlike Twake
 * Tasks, which marks them all read as the list opens, here the person chooses
 * one, a wiki's, or all: opening one marks it read.
 */
export function NotificationsScreen(): ReactElement {
  const { t } = useI18n()
  useDocumentTitle(t('notifications.title'))
  const notifications = useNotifications()
  const unread = notifications.data?.unread ?? 0

  return (
    <main className="u-p-2">
      <PageHeader
        title={
          <Typography variant="h3" component="h1">
            {t('notifications.title')}
          </Typography>
        }
        actions={<MarkAllRead unread={unread} />}
      />
      <List list={notifications} />
    </main>
  )
}

/** Marks every unread notification read, the ones the list does not show too. */
function MarkAllRead({ unread }: { unread: number }): ReactElement | null {
  const { t } = useI18n()
  const markRead = useMarkRead()
  if (unread === 0) return null
  return (
    <Button
      variant="secondary"
      size="small"
      disabled={markRead.isPending}
      onClick={() => {
        markRead.mutate({ all: true })
      }}
    >
      {t('notifications.markAllRead')}
    </Button>
  )
}

function List({
  list
}: {
  list: ReturnType<typeof useNotifications>
}): ReactElement {
  const { t } = useI18n()
  if (list.isError) {
    return <Typography role="alert">{t('notifications.loadFailed')}</Typography>
  }
  if (!list.data) return <ListSkeleton label={t('app.loading')} />
  const notifications = list.data.notifications
  if (notifications.length === 0) {
    return (
      <EmptyState
        icon={Bell}
        title={t('notifications.empty')}
        text={t('notifications.emptyHint')}
      />
    )
  }
  return (
    <Feed label={t('notifications.title')}>
      {notifications.map(notification => (
        <Item key={notification.id} notification={notification} />
      ))}
    </Feed>
  )
}

function Item({ notification }: { notification: Notification }): ReactElement {
  const { t, lang } = useI18n()
  const wikiName = useWikiName()
  const entryOf = usePageEntry()
  const markRead = useMarkRead()
  const actor = displayName(notification.actor)
  // The wikis tell their home pages, so the page shows under its wiki's name
  // once they are read; until then it opens by its own address.
  const entry = entryOf?.({
    id: notification.page.id,
    title: notification.page.title,
    wiki: notification.wiki
  })
  const path =
    entry?.path ??
    `/wikis/${notification.wiki.id}/pages/${notification.page.id}`
  const title = entry?.title ?? notification.page.title
  const unread = notification.readAt === null
  const reason = t(`notifications.reason.${notification.reason}`, { actor })
  return (
    <FeedItem
      avatar={
        <PersonAvatar
          email={notification.actor.email}
          name={notification.actor.name}
        />
      }
      {...(unread ? { label: t('notifications.unreadItem', { title }) } : {})}
    >
      <Typography variant="body2">
        {unread && (
          <>
            <Icon icon={CircleFilled} size={8} />
            {` `}
          </>
        )}
        <Link
          component={RouterLink}
          to={path}
          underline="hover"
          onClick={() => {
            markRead.mutate({ ids: [notification.id] })
          }}
        >
          {title}
        </Link>
      </Typography>
      <Typography variant="body2" color="textSecondary">
        {`${reason} · ${wikiName(notification.wiki)} · ${localTime(
          notification.createdAt,
          lang
        )}`}
      </Typography>
    </FeedItem>
  )
}

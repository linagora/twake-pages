import { Icon, Restore, Trash } from '@linagora/twake-icons'
import { Alert, Button, Link, Typography } from '@linagora/twake-mui'
import { useState, type ReactElement } from 'react'
import { Link as RouterLink, useParams } from 'react-router'

import { EmptyState, ListSkeleton } from '@/ds/EmptyState'
import { PageHeader } from '@/ds/PageHeader'
import { Feed, FeedItem, FeedNote } from '@/ds/SidePanel'
import type { TrashEntry } from '@/domain/page'
import { displayName } from '@/domain/person'
import { useI18n } from '@/ui/i18n/useI18n'
import { PersonAvatar } from '@/ui/people/PersonAvatar'
import { localTime } from '@/ui/settings/zone'
import { useDocumentTitle } from '@/ui/useDocumentTitle'
import { useRestorePage, useTrash, useWiki } from '@/ui/wiki/queries'

const DAY = 24 * 3600 * 1000
const RETENTION_DAYS = 30

const daysLeft = (at: string) =>
  Math.max(
    1,
    Math.ceil((Date.parse(at) + RETENTION_DAYS * DAY - Date.now()) / DAY)
  )

/**
 * The wiki's deleted pages, newest first, under how long they stay in the
 * trash, as Twake Tasks lists the tasks of its own.
 */
export function TrashScreen(): ReactElement {
  const { t } = useI18n()
  const { wikiId = '' } = useParams()
  const wiki = useWiki(wikiId)
  const trash = useTrash(wikiId)
  // Unlike Twake Tasks, which restores from the line of a task, the screen
  // restores and tells of it: the line leaves the list once the trash is read
  // again, and with it what its restore became.
  const restore = useRestorePage(wikiId)
  const [restored, setRestored] = useState<TrashEntry | null>(null)
  const title = t('trash.title')
  useDocumentTitle(title)
  const entries = trash.data ?? []
  const editable = wiki.data !== undefined && wiki.data.role !== 'viewer'

  return (
    <main className="u-p-2">
      <PageHeader
        title={
          <Typography variant="h3" component="h1">
            {title}
          </Typography>
        }
      />
      {/* A status, where Twake Tasks keeps the role of an alert: it tells
          nothing gone wrong, and an alert of the restore stands out. */}
      {entries.length > 0 && (
        <Alert severity="info" role="status" className="u-mb-1">
          {t('trash.retention')}
        </Alert>
      )}
      {trash.isError && (
        <Alert severity="error" className="u-mb-1">
          {t('trash.loadFailed')}
        </Alert>
      )}
      {restored && restore.isSuccess && (
        <Alert severity="success" role="status" className="u-mb-1">
          {t('trash.restored', { title: restored.title })}
        </Alert>
      )}
      {restored && restore.isError && (
        <Alert severity="error" className="u-mb-1">
          {t('trash.restoreFailed', { title: restored.title })}
        </Alert>
      )}
      {trash.isPending && <ListSkeleton label={t('app.loading')} />}
      {trash.isSuccess && entries.length === 0 && (
        <EmptyState
          icon={Trash}
          title={t('trash.empty')}
          text={t('trash.retention')}
        />
      )}
      {entries.length > 0 && (
        <Feed label={title}>
          {entries.map(entry => (
            <DeletedPage
              key={entry.id}
              entry={entry}
              editable={editable}
              restoring={restore.isPending}
              onRestore={() => {
                setRestored(entry)
                restore.mutate(entry.id)
              }}
            />
          ))}
        </Feed>
      )}
    </main>
  )
}

/**
 * A line of who deleted the page, when, with how many pages, and how many
 * days it has left, where Twake Tasks lines its trash up in columns: a task
 * has people, a priority and labels to compare, which a deleted page has
 * not. The time shows by its day and hour, as Pages shows when a version was
 * published, where Twake Tasks tells how long ago.
 */
function DeletedPage({
  entry,
  editable,
  restoring,
  onRestore
}: {
  entry: TrashEntry
  editable: boolean
  restoring: boolean
  onRestore: () => void
}): ReactElement {
  const { t, lang } = useI18n()
  const left = daysLeft(entry.deletedAt)

  return (
    <FeedItem
      label={entry.title}
      avatar={
        <PersonAvatar
          email={entry.deletedBy.email}
          name={entry.deletedBy.name}
        />
      }
    >
      <Typography variant="body2">
        <Link
          component={RouterLink}
          to={`../pages/${entry.id}`}
          underline="hover"
        >
          {entry.title}
        </Link>
        {entry.descendants > 0 &&
          ` · ${t('trash.inside', { smart_count: entry.descendants })}`}
      </Typography>
      <Typography variant="body2" color="textSecondary">
        {t('trash.deletedBy', {
          name: displayName(entry.deletedBy),
          time: localTime(entry.deletedAt, lang)
        })}
      </Typography>
      <FeedNote
        tone={left <= 3 ? 'error' : left <= 7 ? 'warning' : 'textSecondary'}
      >
        {t('trash.daysLeft', { smart_count: left })}
      </FeedNote>
      {editable && (
        <Button
          variant="text"
          size="small"
          startIcon={<Icon icon={Restore} />}
          aria-label={t('trash.restorePage', { title: entry.title })}
          disabled={restoring}
          onClick={onRestore}
        >
          {t('trash.restore')}
        </Button>
      )}
    </FeedItem>
  )
}

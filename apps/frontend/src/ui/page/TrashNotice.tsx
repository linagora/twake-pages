import { Icon, Restore } from '@linagora/twake-icons'
import { Alert, Button } from '@linagora/twake-mui'
import type { ReactElement } from 'react'
import { Link as RouterLink } from 'react-router'

import type { Page } from '@/domain/page'
import { useI18n } from '@/ui/i18n/useI18n'
import { useRestorePage, useWiki } from '@/ui/wiki/queries'

/**
 * Tells that the page is in the trash, as Twake Tasks tells of a task there,
 * and offers editors to restore it. A page deleted with its parent comes back
 * with it only, so it leads to that page instead.
 */
export function TrashNotice({ page }: { page: Page }): ReactElement {
  const { t } = useI18n()
  const wiki = useWiki(page.wikiId)
  const restore = useRestorePage(page.wikiId)
  // Its root is among its ancestors, as the branch keeps its shape.
  const root = page.ancestors.find(({ id }) => id === page.trashRootId)

  if (root) {
    return (
      <Alert
        severity="info"
        className="u-mb-1"
        action={
          <Button
            component={RouterLink}
            to={`../pages/${root.id}`}
            variant="text"
            size="small"
          >
            {t('page.openDeletedWith', { title: root.title })}
          </Button>
        }
      >
        {t('page.inTrashWith', { title: root.title })}
      </Alert>
    )
  }

  const editable = wiki.data !== undefined && wiki.data.role !== 'viewer'
  return (
    <Alert
      severity={restore.isError ? 'error' : 'info'}
      className="u-mb-1"
      action={
        editable && (
          <Button
            variant="text"
            size="small"
            startIcon={<Icon icon={Restore} />}
            disabled={restore.isPending}
            onClick={() => {
              restore.mutate(page.id)
            }}
          >
            {t('page.restore')}
          </Button>
        )
      }
    >
      {restore.isError ? t('page.restoreFailed') : t('page.inTrash')}
    </Alert>
  )
}

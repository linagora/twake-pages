import type { ReactElement } from 'react'
import { useNavigate } from 'react-router'

import { ConfirmDialog } from '@/ds/ConfirmDialog'
import type { Page } from '@/domain/page'
import { useI18n } from '@/ui/i18n/useI18n'
import { useDeletePage } from '@/ui/wiki/queries'

/**
 * Asks before the page goes to the trash, which Twake Tasks does not for a
 * task, offering to undo instead: a page takes its child pages along, and the
 * screen leaves it, for its parent or, from the top of the tree, for the home
 * page.
 */
export function DeletePageDialog({
  page,
  onClose
}: {
  page: Page
  onClose: () => void
}): ReactElement {
  const { t } = useI18n()
  const navigate = useNavigate()
  const remove = useDeletePage(page, () => {
    // The screen may show the parent at once, read before, with this menu.
    onClose()
    void navigate(page.parentId === null ? '..' : `../pages/${page.parentId}`)
  })

  return (
    <ConfirmDialog
      title={t('deletePage.title', { title: page.title })}
      text={t('deletePage.text')}
      confirm={t('deletePage.confirm')}
      cancel={t('deletePage.cancel')}
      failed={remove.isError ? t('deletePage.failed') : null}
      pending={remove.isPending}
      onConfirm={() => {
        remove.mutate()
      }}
      onClose={onClose}
    />
  )
}

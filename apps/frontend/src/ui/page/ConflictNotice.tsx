import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle
} from '@linagora/twake-mui'
import { useId, type ReactElement } from 'react'

import type { VersionSummary } from '@/domain/page'
import { displayName } from '@/domain/person'
import { useI18n } from '@/ui/i18n/useI18n'
import { localTime } from '@/ui/settings/zone'

/**
 * The version published after the one the draft started from, by whom and
 * when, and what the person can do about it (ADR 012). Twake Tasks only says
 * that someone else changed a description, as its answer names no one.
 */
export function ConflictNotice({
  current,
  onReload,
  onPublishOver
}: {
  current: VersionSummary
  onReload: () => void
  onPublishOver: () => void
}): ReactElement {
  const { t, lang } = useI18n()

  return (
    <Alert severity="warning" className="u-mb-1">
      {t('editor.conflict', {
        author: displayName(current.author),
        number: current.number,
        time: localTime(current.createdAt, lang)
      })}
      <div className="u-mt-half">
        <Button variant="text" onClick={onReload}>
          {t('editor.reload')}
        </Button>
        <Button variant="text" onClick={onPublishOver}>
          {t('editor.publishOver')}
        </Button>
      </div>
    </Alert>
  )
}

/**
 * Asks before the draft takes the place of the current version for everyone,
 * which Twake Tasks does without asking when a description is saved again.
 */
export function PublishOverDialog({
  current,
  onConfirm,
  onClose
}: {
  current: VersionSummary
  onConfirm: () => void
  onClose: () => void
}): ReactElement {
  const { t } = useI18n()
  const titleId = useId()

  return (
    <Dialog open onClose={onClose} aria-labelledby={titleId} size="small">
      <form
        onSubmit={event => {
          event.preventDefault()
          onConfirm()
        }}
      >
        <DialogTitle id={titleId}>
          {t('editor.publishOverTitle', { number: current.number })}
        </DialogTitle>
        <DialogContent>
          <DialogContentText>
            {t('editor.publishOverText', {
              author: displayName(current.author)
            })}
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button variant="text" onClick={onClose}>
            {t('editor.cancel')}
          </Button>
          <Button type="submit">{t('editor.publishOver')}</Button>
        </DialogActions>
      </form>
    </Dialog>
  )
}

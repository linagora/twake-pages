import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Typography
} from '@linagora/twake-mui'
import { useId, type ReactElement } from 'react'

/**
 * Asks the person to be sure before a change that `onConfirm` makes, and
 * tells why it `failed`, if it did.
 */
export function ConfirmDialog({
  title,
  text,
  confirm,
  cancel,
  failed,
  pending,
  onConfirm,
  onClose
}: {
  title: string
  text: string
  confirm: string
  cancel: string
  failed: string | null
  pending: boolean
  onConfirm: () => void
  onClose: () => void
}): ReactElement {
  const titleId = useId()

  return (
    <Dialog open onClose={onClose} aria-labelledby={titleId} size="small">
      <form
        onSubmit={event => {
          event.preventDefault()
          onConfirm()
        }}
      >
        <DialogTitle id={titleId}>{title}</DialogTitle>
        <DialogContent>
          <DialogContentText>{text}</DialogContentText>
          {failed !== null && (
            <Typography role="alert" color="error">
              {failed}
            </Typography>
          )}
        </DialogContent>
        <DialogActions>
          <Button variant="text" onClick={onClose}>
            {cancel}
          </Button>
          <Button type="submit" color="error" disabled={pending}>
            {confirm}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  )
}

import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  TextField,
  Typography
} from '@linagora/twake-mui'
import { useId, useState, type ReactElement } from 'react'

import { useI18n } from '@/ui/i18n/useI18n'

export interface WikiFields {
  name: string
  description: string
}

const BLANK: WikiFields = { name: '', description: '' }

/**
 * The name and description of a wiki, a new one or one its admin edits. A
 * wiki that is not named by its admin, personal or of a space, shows no name.
 */
export function WikiDialog({
  title,
  submit,
  initial = BLANK,
  named = true,
  saving,
  failed,
  onSave,
  onClose
}: {
  title: string
  submit: string
  initial?: WikiFields
  named?: boolean
  saving: boolean
  failed: string | null
  onSave: (fields: WikiFields) => void
  onClose: () => void
}): ReactElement {
  const { t } = useI18n()
  const titleId = useId()
  const [name, setName] = useState(initial.name)
  const [description, setDescription] = useState(initial.description)

  return (
    <Dialog open onClose={onClose} aria-labelledby={titleId} size="small">
      <form
        onSubmit={event => {
          event.preventDefault()
          onSave({ name: name.trim(), description: description.trim() })
        }}
      >
        <DialogTitle id={titleId}>{title}</DialogTitle>
        <DialogContent>
          {named && (
            <TextField
              label={t('wikiDialog.name')}
              value={name}
              onChange={event => {
                setName(event.target.value)
              }}
              required
              fullWidth
              margin="dense"
              slotProps={{ htmlInput: { maxLength: 100 } }}
            />
          )}
          <TextField
            label={t('wikiDialog.description')}
            value={description}
            onChange={event => {
              setDescription(event.target.value)
            }}
            fullWidth
            multiline
            minRows={2}
            margin="dense"
            slotProps={{ htmlInput: { maxLength: 500 } }}
          />
          {failed && (
            <Typography role="alert" color="error">
              {failed}
            </Typography>
          )}
        </DialogContent>
        <DialogActions>
          <Button variant="text" onClick={onClose}>
            {t('wikiDialog.cancel')}
          </Button>
          <Button type="submit" disabled={saving || (named && !name.trim())}>
            {submit}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  )
}

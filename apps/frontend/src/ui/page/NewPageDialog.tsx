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

import type { Page } from '@/domain/page'
import { useI18n } from '@/ui/i18n/useI18n'
import { blocksOf, TEMPLATES, type Template } from '@/ui/page/templates'
import { useCreatePage } from '@/ui/wiki/queries'

/** The title and the template of a page made at the top of the tree. */
export function NewPageDialog({
  wikiId,
  onCreated,
  onClose
}: {
  wikiId: string
  onCreated: (page: Page) => void
  onClose: () => void
}): ReactElement {
  const { t } = useI18n()
  const titleId = useId()
  const [title, setTitle] = useState('')
  const [template, setTemplate] = useState<Template>('blank')
  const create = useCreatePage(wikiId)

  return (
    <Dialog open onClose={onClose} aria-labelledby={titleId} size="small">
      <form
        onSubmit={event => {
          event.preventDefault()
          create.mutate(
            {
              title: title.trim(),
              kind: 'document',
              parentId: null,
              content: blocksOf(template, t)
            },
            { onSuccess: onCreated }
          )
        }}
      >
        <DialogTitle id={titleId}>{t('newPage.title')}</DialogTitle>
        <DialogContent>
          <TextField
            label={t('newPage.pageTitle')}
            value={title}
            onChange={event => {
              setTitle(event.target.value)
            }}
            required
            fullWidth
            margin="dense"
            slotProps={{ htmlInput: { maxLength: 200 } }}
          />
          <TextField
            select
            fullWidth
            margin="dense"
            label={t('newPage.template')}
            value={template}
            onChange={event => {
              const chosen = TEMPLATES.find(id => id === event.target.value)
              if (chosen) setTemplate(chosen)
            }}
            slotProps={{
              select: { native: true },
              inputLabel: { shrink: true }
            }}
          >
            {TEMPLATES.map(id => (
              <option key={id} value={id}>
                {t(`templates.${id}.name`)}
              </option>
            ))}
          </TextField>
          {create.isError && (
            <Typography role="alert" color="error">
              {t('newPage.failed')}
            </Typography>
          )}
        </DialogContent>
        <DialogActions>
          <Button variant="text" onClick={onClose}>
            {t('newPage.cancel')}
          </Button>
          <Button type="submit" disabled={create.isPending || !title.trim()}>
            {t('newPage.create')}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  )
}

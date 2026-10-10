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

import { ApiError } from '@/application/pages'
import type { Page, PageKind } from '@/domain/page'
import { useGristOrigins } from '@/ui/GristOriginsProvider'
import { listed } from '@/ui/i18n/listed'
import { useI18n } from '@/ui/i18n/useI18n'
import { blocksOf, TEMPLATES, type Template } from '@/ui/page/templates'
import { useCreatePage } from '@/ui/wiki/queries'

/** The kinds of page the dialog makes, the first unless another is chosen. */
const KINDS: readonly PageKind[] = ['document', 'database']

/**
 * The title of a page made under `parent`, else at the top of the tree, and
 * its template, or for a database the address of its Grist document.
 */
export function NewPageDialog({
  wikiId,
  parent,
  onCreated,
  onClose
}: {
  wikiId: string
  parent?: { id: string; title: string } | undefined
  onCreated: (page: Page) => void
  onClose: () => void
}): ReactElement {
  const { t, lang } = useI18n()
  const titleId = useId()
  const [title, setTitle] = useState('')
  const [kind, setKind] = useState<PageKind>('document')
  const [template, setTemplate] = useState<Template>('blank')
  const [gristUrl, setGristUrl] = useState('')
  const gristOrigins = useGristOrigins()
  const create = useCreatePage(wikiId)
  const database = kind === 'database'
  const addressRefused =
    create.error instanceof ApiError &&
    create.error.code === 'invalid_grist_url'

  return (
    <Dialog open onClose={onClose} aria-labelledby={titleId} size="small">
      <form
        onSubmit={event => {
          event.preventDefault()
          const placed = { title: title.trim(), parentId: parent?.id ?? null }
          create.mutate(
            database
              ? { ...placed, kind, gristUrl: gristUrl.trim() }
              : { ...placed, kind, content: blocksOf(template, t) },
            { onSuccess: onCreated }
          )
        }}
      >
        <DialogTitle id={titleId}>
          {parent
            ? t('newPage.under', { title: parent.title })
            : t('newPage.title')}
        </DialogTitle>
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
          {/* Where the pages frame no Grist, a database would show nothing. */}
          {gristOrigins.length > 0 && (
            <TextField
              select
              fullWidth
              margin="dense"
              label={t('newPage.kind')}
              value={kind}
              onChange={event => {
                const chosen = KINDS.find(id => id === event.target.value)
                if (chosen) setKind(chosen)
              }}
              slotProps={{
                select: { native: true },
                inputLabel: { shrink: true }
              }}
            >
              {KINDS.map(id => (
                <option key={id} value={id}>
                  {t(`newPage.kinds.${id}`)}
                </option>
              ))}
            </TextField>
          )}
          {database ? (
            <TextField
              label={t('newPage.gristUrl')}
              value={gristUrl}
              onChange={event => {
                setGristUrl(event.target.value)
                create.reset()
              }}
              required
              fullWidth
              margin="dense"
              error={addressRefused}
              helperText={
                addressRefused
                  ? t('newPage.invalidGristUrl', {
                      origins: listed(gristOrigins, lang)
                    })
                  : t('newPage.gristUrlHint')
              }
            />
          ) : (
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
          )}
          {create.isError && !addressRefused && (
            <Typography role="alert" color="error">
              {t('newPage.failed')}
            </Typography>
          )}
        </DialogContent>
        <DialogActions>
          <Button variant="text" onClick={onClose}>
            {t('newPage.cancel')}
          </Button>
          <Button
            type="submit"
            disabled={
              create.isPending ||
              !title.trim() ||
              (database && !gristUrl.trim())
            }
          >
            {t('newPage.create')}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  )
}

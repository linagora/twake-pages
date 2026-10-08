import { Dots, Icon, Pen, Trash } from '@linagora/twake-icons'
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  IconButton,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Typography
} from '@linagora/twake-mui'
import { useId, useState, type ElementType, type ReactElement } from 'react'
import { useNavigate } from 'react-router'

import type { Wiki } from '@/domain/wiki'
import { useI18n } from '@/ui/i18n/useI18n'
import { useDeleteWiki, useEditWiki } from '@/ui/wiki/queries'
import { useWikiName } from '@/ui/wiki/useWikiName'
import { WikiDialog } from '@/ui/wiki/WikiDialog'

type Action = 'edit' | 'delete'

/** What the admin of a wiki does with it. */
export function WikiMenu({ wiki }: { wiki: Wiki }): ReactElement {
  const { t } = useI18n()
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const [action, setAction] = useState<Action | null>(null)
  const close = (): void => {
    setAnchor(null)
  }
  const done = (): void => {
    setAction(null)
  }
  const item = (icon: ElementType, label: string, chosen: Action) => (
    <MenuItem
      onClick={() => {
        close()
        setAction(chosen)
      }}
    >
      <ListItemIcon>
        <Icon icon={icon} />
      </ListItemIcon>
      <ListItemText>{label}</ListItemText>
    </MenuItem>
  )

  return (
    <>
      <IconButton
        aria-label={t('wiki.menu')}
        aria-haspopup="menu"
        aria-expanded={anchor !== null}
        onClick={event => {
          setAnchor(event.currentTarget)
        }}
      >
        <Icon icon={Dots} />
      </IconButton>
      <Menu
        anchorEl={anchor}
        open={anchor !== null}
        onClose={close}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
      >
        {item(Pen, t('wiki.edit'), 'edit')}
        {/* A personal wiki goes with its person, a space wiki with its space. */}
        {wiki.kind === 'shared' && item(Trash, t('wiki.delete'), 'delete')}
      </Menu>
      {action === 'edit' && <EditWikiDialog wiki={wiki} onClose={done} />}
      {action === 'delete' && <DeleteWikiDialog wiki={wiki} onClose={done} />}
    </>
  )
}

function EditWikiDialog({
  wiki,
  onClose
}: {
  wiki: Wiki
  onClose: () => void
}): ReactElement {
  const { t } = useI18n()
  const edit = useEditWiki(wiki)
  // A personal wiki shows a label, and a space wiki is named after its space.
  const named = wiki.kind === 'shared'

  return (
    <WikiDialog
      title={t('editWiki.title')}
      submit={t('editWiki.save')}
      initial={wiki}
      named={named}
      change={edit}
      onSaved={onClose}
      onClose={onClose}
    />
  )
}

function DeleteWikiDialog({
  wiki,
  onClose
}: {
  wiki: Wiki
  onClose: () => void
}): ReactElement {
  const { t } = useI18n()
  const titleId = useId()
  const navigate = useNavigate()
  const wikiName = useWikiName()
  const remove = useDeleteWiki(wiki.id)

  return (
    <Dialog open onClose={onClose} aria-labelledby={titleId} size="small">
      <form
        onSubmit={event => {
          event.preventDefault()
          // The stream may tell the wiki is gone before its answer does, and
          // the screen it closes would drop the callbacks given to mutate.
          void remove.mutateAsync().then(
            () => navigate('/'),
            () => undefined
          )
        }}
      >
        <DialogTitle id={titleId}>
          {t('deleteWiki.title', { name: wikiName(wiki) })}
        </DialogTitle>
        <DialogContent>
          <DialogContentText>{t('deleteWiki.text')}</DialogContentText>
          {remove.isError && (
            <Typography role="alert" color="error">
              {t('deleteWiki.failed')}
            </Typography>
          )}
        </DialogContent>
        <DialogActions>
          <Button variant="text" onClick={onClose}>
            {t('deleteWiki.cancel')}
          </Button>
          <Button type="submit" color="error" disabled={remove.isPending}>
            {t('deleteWiki.confirm')}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  )
}

import { Dots, Icon, Moveto, Plus } from '@linagora/twake-icons'
import {
  IconButton,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem
} from '@linagora/twake-mui'
import { useState, type ReactElement } from 'react'
import { useNavigate } from 'react-router'

import type { Page } from '@/domain/page'
import { useI18n } from '@/ui/i18n/useI18n'
import { MovePageDialog } from '@/ui/page/MovePageDialog'
import { NewPageDialog } from '@/ui/page/NewPageDialog'
import { useWiki } from '@/ui/wiki/queries'

/** What an editor of the wiki does with a page, drawn as the wiki's menu. */
export function PageMenu({ page }: { page: Page }): ReactElement | null {
  const { t } = useI18n()
  const navigate = useNavigate()
  const wiki = useWiki(page.wikiId)
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const [creating, setCreating] = useState(false)
  const [moving, setMoving] = useState(false)
  const close = (): void => {
    setAnchor(null)
  }

  // The home page has no children and never moves, and a page in the trash
  // takes none and stays put: with nothing else to offer, the menu does not
  // show.
  const editable = wiki.data !== undefined && wiki.data.role !== 'viewer'
  if (!editable || page.home || page.deletedAt !== null) return null

  return (
    <>
      <IconButton
        aria-label={t('page.menu')}
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
        <MenuItem
          onClick={() => {
            close()
            setCreating(true)
          }}
        >
          <ListItemIcon>
            <Icon icon={Plus} />
          </ListItemIcon>
          <ListItemText>{t('page.newChild')}</ListItemText>
        </MenuItem>
        <MenuItem
          onClick={() => {
            close()
            setMoving(true)
          }}
        >
          <ListItemIcon>
            <Icon icon={Moveto} />
          </ListItemIcon>
          <ListItemText>{t('page.move')}</ListItemText>
        </MenuItem>
      </Menu>
      {creating && (
        <NewPageDialog
          wikiId={page.wikiId}
          parent={page}
          onClose={() => {
            setCreating(false)
          }}
          onCreated={child => {
            setCreating(false)
            void navigate(`../pages/${child.id}`)
          }}
        />
      )}
      <MovePageDialog
        page={page}
        open={moving}
        onClose={() => {
          setMoving(false)
        }}
      />
    </>
  )
}

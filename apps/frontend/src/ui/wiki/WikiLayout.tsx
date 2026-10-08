import {
  List,
  ListItem,
  ListItemButton,
  ListItemText
} from '@linagora/twake-mui'
import type { ReactElement } from 'react'
import { Outlet } from 'react-router'

import { WikiFrame } from '@/ds/WikiFrame'
import { useI18n } from '@/ui/i18n/useI18n'
import { EntryLink } from '@/ui/shell/SidebarLink'

export function WikiLayout(): ReactElement {
  const { t } = useI18n()
  return (
    <WikiFrame
      sidebar={
        <nav aria-label={t('wiki.nav')}>
          <List>
            <WikiLink to="." end label={t('wiki.home')} />
            <WikiLink to="search" label={t('search.title')} />
            <WikiLink to="trash" label={t('trash.title')} />
          </List>
        </nav>
      }
    >
      <Outlet />
    </WikiFrame>
  )
}

// Not SidebarLink: below lg, the NavLink of twake-mui draws an entry of the
// phone bottom bar, and this column is a list at every width.
function WikiLink({
  to,
  end = false,
  label
}: {
  to: string
  end?: boolean
  label: string
}): ReactElement {
  return (
    <ListItem disablePadding>
      <EntryLink to={to} end={end}>
        {active => (
          <ListItemButton selected={active} role="presentation" tabIndex={-1}>
            <ListItemText primary={label} />
          </ListItemButton>
        )}
      </EntryLink>
    </ListItem>
  )
}

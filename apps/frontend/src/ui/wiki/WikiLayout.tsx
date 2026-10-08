import {
  List,
  ListItem,
  ListItemButton,
  ListItemText
} from '@linagora/twake-mui'
import type { ReactElement } from 'react'
import { NavLink, Outlet } from 'react-router'

import { SidebarEntry } from '@/ds/AppFrame'
import { WikiFrame } from '@/ds/WikiFrame'
import { useI18n } from '@/ui/i18n/useI18n'

// The screens of a wiki, beside its own navigation, where its tree will go.
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

// As SidebarLink: the router link is the focusable element, and the list
// button only draws it.
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
      <SidebarEntry>
        <NavLink to={to} end={end}>
          {({ isActive }) => (
            <ListItemButton
              selected={isActive}
              role="presentation"
              tabIndex={-1}
            >
              <ListItemText primary={label} />
            </ListItemButton>
          )}
        </NavLink>
      </SidebarEntry>
    </ListItem>
  )
}

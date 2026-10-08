import { NavLink } from '@linagora/twake-mui'
import type { ReactElement, ReactNode } from 'react'
import { NavLink as RouterNavLink } from 'react-router'

import { SidebarEntry } from '@/ds/AppFrame'

interface Entry {
  to: string
  end?: boolean
  label?: string | undefined
}

// The router link is the one focusable, named element: what it holds only
// draws the entry, with no role and out of the tab order.
export function EntryLink({
  to,
  end = false,
  label,
  children
}: Entry & { children: (active: boolean) => ReactNode }): ReactElement {
  return (
    <SidebarEntry>
      <RouterNavLink
        to={to}
        end={end}
        {...(label ? { 'aria-label': label } : {})}
      >
        {({ isActive }) => children(isActive)}
      </RouterNavLink>
    </SidebarEntry>
  )
}

// The NavLink of twake-mui is a div with role button.
export function SidebarLink({
  children,
  ...entry
}: Entry & { children: ReactNode }): ReactElement {
  return (
    <EntryLink {...entry}>
      {active => (
        <NavLink selected={active} role="presentation" tabIndex={-1}>
          {children}
        </NavLink>
      )}
    </EntryLink>
  )
}

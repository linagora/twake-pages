import { NavLink } from '@linagora/twake-mui'
import type { ReactElement, ReactNode } from 'react'
import { NavLink as RouterNavLink } from 'react-router'

import { SidebarEntry } from '@/ds/AppFrame'

// The router link is the one focusable, named element; the NavLink of
// twake-mui is a div with role button, so it only draws the entry.
export function SidebarLink({
  to,
  end = false,
  label,
  children
}: {
  to: string
  end?: boolean
  label?: string | undefined
  children: ReactNode
}): ReactElement {
  return (
    <SidebarEntry>
      <RouterNavLink
        to={to}
        end={end}
        {...(label ? { 'aria-label': label } : {})}
      >
        {({ isActive }) => (
          <NavLink selected={isActive} role="presentation" tabIndex={-1}>
            {children}
          </NavLink>
        )}
      </RouterNavLink>
    </SidebarEntry>
  )
}

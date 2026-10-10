import { Bell, Home, Icon, Logout } from '@linagora/twake-icons'
import {
  Divider,
  IconButton,
  Link,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Nav,
  NavIcon,
  NavItem,
  NavText
} from '@linagora/twake-mui'
import {
  useRef,
  useState,
  type ElementType,
  type ReactElement,
  type RefObject
} from 'react'
import { Outlet, Link as RouterLink, useLocation } from 'react-router'

import {
  AccountCard,
  AppFrame,
  BrandMark,
  CountBadge,
  TopBar,
  TopBarSearch,
  TopBarSpacer
} from '@/ds/AppFrame'
import { displayName } from '@/domain/person'
import { useI18n } from '@/ui/i18n/useI18n'
import { PersonAvatar } from '@/ui/people/PersonAvatar'
import { AppSearchField } from '@/ui/search/SearchField'
import { useSession } from '@/ui/session/SessionGate'
import { useSettings } from '@/ui/settings/useSettings'
import { PlatformBar } from '@/ui/shell/PlatformBar'
import { ShortcutsHelp, useShortcuts } from '@/ui/shell/Shortcuts'
import { SidebarLink } from '@/ui/shell/SidebarLink'
import { useNotifications } from '@/ui/wiki/queries'

export function AppShell(): ReactElement {
  const [help, setHelp] = useState(false)
  const search = useRef<HTMLInputElement>(null)
  useShortcuts({
    search: () => {
      search.current?.focus()
    },
    help: () => {
      setHelp(true)
    }
  })

  return (
    <AppFrame topBar={<Header searchRef={search} />} sidebar={<AppNav />}>
      <Outlet />
      {help && (
        <ShortcutsHelp
          onClose={() => {
            setHelp(false)
          }}
        />
      )}
    </AppFrame>
  )
}

function Header({
  searchRef
}: {
  searchRef: RefObject<HTMLInputElement | null>
}): ReactElement {
  const { t } = useI18n()
  const { sdk } = useSession()

  // The platform bar is 48px tall: a medium search bar would fill it.
  const search = (
    <TopBarSearch>
      <AppSearchField inputRef={searchRef} size={sdk ? 'small' : 'medium'} />
    </TopBarSearch>
  )

  // The platform bar holds the account.
  if (sdk) {
    return (
      <PlatformBar
        sdk={sdk}
        slots={{ search: <div className="u-mh-1">{search}</div> }}
      />
    )
  }

  return (
    <TopBar>
      <Link
        component={RouterLink}
        to="/"
        underline="none"
        aria-label={t('app.name')}
      >
        <BrandMark name={t('app.name')} />
      </Link>
      {search}
      <TopBarSpacer />
      <AccountMenu />
    </TopBar>
  )
}

function AccountMenu(): ReactElement {
  const { t } = useI18n()
  const { user, signOut } = useSession()
  const { data: settings } = useSettings()
  const email = user.email ?? ''
  const name = displayName({ email, name: settings?.name ?? user.name ?? null })
  const { pathname } = useLocation()
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const [openedOn, setOpenedOn] = useState(pathname)
  if (anchor !== null && openedOn !== pathname) setAnchor(null)
  const close = (): void => {
    setAnchor(null)
  }
  const avatar = (size: 's' | 'l'): ReactElement => (
    <PersonAvatar
      email={email}
      name={name}
      avatar={settings?.avatar}
      size={size}
    />
  )

  return (
    <>
      <IconButton
        aria-label={name}
        aria-haspopup="menu"
        aria-expanded={anchor !== null}
        onClick={event => {
          setAnchor(event.currentTarget)
          setOpenedOn(pathname)
        }}
      >
        {avatar('s')}
      </IconButton>
      <Menu
        anchorEl={anchor}
        open={anchor !== null}
        onClose={close}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
      >
        <AccountCard
          avatar={avatar('l')}
          name={name}
          email={email === name ? undefined : email}
        />
        <Divider />
        <MenuItem
          onClick={() => {
            close()
            void signOut()
          }}
        >
          <ListItemIcon>
            <Icon icon={Logout} />
          </ListItemIcon>
          <ListItemText>{t('session.signOut')}</ListItemText>
        </MenuItem>
      </Menu>
    </>
  )
}

function AppNav(): ReactElement {
  const { t } = useI18n()
  const unread = useNotifications().data?.unread ?? 0

  return (
    <Nav>
      <AppNavLink to="/" end icon={Home} label={t('wikis.title')} />
      <AppNavLink
        to="/notifications"
        icon={Bell}
        label={t('notifications.title')}
        count={unread}
        countLabel={t('notifications.unread', { count: unread })}
      />
    </Nav>
  )
}

function AppNavLink({
  to,
  end = false,
  icon,
  label,
  count = 0,
  countLabel
}: {
  to: string
  end?: boolean
  icon: ElementType
  label: string
  count?: number
  countLabel?: string
}): ReactElement {
  return (
    <NavItem>
      <SidebarLink to={to} end={end} label={count > 0 ? countLabel : undefined}>
        <CountBadge count={count}>
          <NavIcon icon={icon} />
        </CountBadge>
        <NavText>{label}</NavText>
      </SidebarLink>
    </NavItem>
  )
}

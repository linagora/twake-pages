import { Home, Icon, Logout } from '@linagora/twake-icons'
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
import { useState, type ElementType, type ReactElement } from 'react'
import { Outlet, Link as RouterLink, useLocation } from 'react-router'

import {
  AccountCard,
  AppFrame,
  BrandMark,
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

export function AppShell(): ReactElement {
  const [help, setHelp] = useState(false)
  useShortcuts({
    help: () => {
      setHelp(true)
    }
  })

  return (
    <AppFrame topBar={<Header />} sidebar={<AppNav />}>
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

function Header(): ReactElement {
  const { t } = useI18n()
  const { sdk } = useSession()

  // The platform bar is 48px tall: a medium search bar would fill it.
  const search = (
    <TopBarSearch>
      <AppSearchField size={sdk ? 'small' : 'medium'} />
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

  return (
    <Nav>
      <AppNavLink to="/" end icon={Home} label={t('wikis.title')} />
    </Nav>
  )
}

function AppNavLink({
  to,
  end = false,
  icon,
  label
}: {
  to: string
  end?: boolean
  icon: ElementType
  label: string
}): ReactElement {
  return (
    <NavItem>
      <SidebarLink to={to} end={end}>
        <NavIcon icon={icon} />
        <NavText>{label}</NavText>
      </SidebarLink>
    </NavItem>
  )
}

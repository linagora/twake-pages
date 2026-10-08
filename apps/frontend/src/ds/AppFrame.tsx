import { File, Icon } from '@linagora/twake-icons'
import {
  Badge,
  Box,
  Content,
  Layout,
  List,
  ListSubheader,
  NavItem,
  Sidebar,
  styled,
  Typography,
  type Theme
} from '@linagora/twake-mui'
import type { ReactElement, ReactNode } from 'react'

export const TOP_BAR_HEIGHT = 64

// Layout forwards `sx` to its div, so it is styled from outside.
const FrameLayout = styled(Layout)(({ theme }) => ({
  flex: '1 1 auto',
  minHeight: 0,
  [theme.breakpoints.down('lg')]: {
    height: 'auto',
    paddingBottom: 'var(--sidebarHeight)'
  }
}))

// Content is `height: 100%` plus a 16px margin on wide screens, which
// overflows the window; stretching it in the flex row keeps the margin inside.
const FrameContent = styled(Content)(({ theme }) => ({
  [theme.breakpoints.up('lg')]: { height: 'auto' }
}))

export function AppFrame({
  topBar,
  sidebar,
  children
}: {
  topBar: ReactNode
  sidebar: ReactNode
  children: ReactNode
}): ReactElement {
  return (
    <Box sx={{ height: '100dvh', display: 'flex', flexDirection: 'column' }}>
      {topBar}
      <FrameLayout withTopBar={false}>
        <Sidebar>{sidebar}</Sidebar>
        <FrameContent role={undefined}>{children}</FrameContent>
      </FrameLayout>
    </Box>
  )
}

export function TopBar({ children }: { children: ReactNode }): ReactElement {
  return (
    <Box
      component="header"
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: { xs: 1, md: 2 },
        flex: '0 0 auto',
        height: TOP_BAR_HEIGHT,
        px: { xs: 2, md: 3 },
        bgcolor: 'background.default'
      }}
    >
      {children}
    </Box>
  )
}

// The brand column lines up with the sidebar below it on wide screens.
export function BrandMark({ name }: { name: string }): ReactElement {
  return (
    <Box
      component="span"
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 1.5,
        width: { lg: 204 },
        color: 'primary.main'
      }}
    >
      <Icon icon={File} size={32} aria-hidden />
      <Typography
        variant="h5"
        component="span"
        color="textPrimary"
        noWrap
        sx={{ display: { xs: 'none', md: 'block' } }}
      >
        {name}
      </Typography>
    </Box>
  )
}

export function TopBarSearch({
  children
}: {
  children: ReactNode
}): ReactElement {
  return (
    <Box
      sx={{
        flex: '1 1 auto',
        minWidth: 0,
        maxWidth: 640,
        '& input::-webkit-search-cancel-button': { display: 'none' }
      }}
    >
      {children}
    </Box>
  )
}

export function TopBarSpacer(): ReactElement {
  return <Box sx={{ flex: '1 1 0' }} />
}

export function CountBadge({
  count,
  children
}: {
  count: number
  children: ReactNode
}): ReactElement {
  if (count === 0) return <>{children}</>
  // The nav icon carries a 12px right margin on wide screens, none on phones.
  return (
    <Badge
      color="error"
      badgeContent={count}
      max={99}
      sx={(theme: Theme) => ({
        '& .MuiBadge-badge': {
          fontSize: 10,
          height: 16,
          minWidth: 16,
          right: 12,
          [theme.breakpoints.down('lg')]: { right: 0 }
        }
      })}
    >
      {children}
    </Badge>
  )
}

// The phone bottom bar has room for five entries.
export const WideScreenNavItem = styled(NavItem)(({ theme }) => ({
  [theme.breakpoints.down('lg')]: { display: 'none' }
}))

// Holds the router link of a sidebar entry, which draws as the entry itself.
export const SidebarEntry = styled('div')(({ theme }) => ({
  display: 'contents',
  '& > a': {
    display: 'flex',
    width: '100%',
    color: 'inherit',
    textDecoration: 'none'
  },
  // The bottom bar greys the entries that are not current, as twake-mui 10.0
  // did; its NavLink now keeps them in the primary text colour.
  [theme.breakpoints.down('lg')]: {
    '& > a:not(.active) > div': { color: theme.vars.palette.text.secondary }
  }
}))

export function AccountCard({
  avatar,
  name,
  email
}: {
  avatar: ReactNode
  name: string
  email?: string | undefined
}): ReactElement {
  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 1.5,
        px: 2,
        py: 1.5,
        minWidth: 240,
        maxWidth: 320
      }}
    >
      {avatar}
      <Box sx={{ minWidth: 0 }}>
        <Typography variant="subtitle1" noWrap>
          {name}
        </Typography>
        {email && (
          <Typography variant="body2" color="textSecondary" noWrap>
            {email}
          </Typography>
        )}
      </Box>
    </Box>
  )
}

// Phones get the bottom bar only; the section stays on wide screens.
export function SidebarSection({
  label,
  children
}: {
  label: string
  children: ReactNode
}): ReactElement {
  return (
    <List
      aria-label={label}
      subheader={
        <ListSubheader component="div" sx={{ bgcolor: 'transparent', px: 3 }}>
          {label}
        </ListSubheader>
      }
      sx={{ display: { xs: 'none', lg: 'block' }, py: 0 }}
    >
      {children}
    </List>
  )
}

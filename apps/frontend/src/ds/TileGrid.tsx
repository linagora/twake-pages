import {
  Avatar,
  Box,
  nameToColor,
  styled,
  Tabs,
  Typography
} from '@linagora/twake-mui'
import type { ReactElement, ReactNode } from 'react'

export function CardTile({
  label,
  badge,
  badgeLabel,
  title,
  tag,
  meta,
  action
}: {
  label: string
  badge: string
  /**
   * What the badge stands for, such as a board's kind in Twake Tasks. A
   * page's badge, the first letter of its title, stands for nothing more, so
   * it goes without a label and is only drawn.
   */
  badgeLabel?: string
  title: ReactNode
  /** A board's key in Twake Tasks. A page has no key to show. */
  tag?: string
  meta: string
  action?: ReactNode
}): ReactElement {
  return (
    <Box
      component="li"
      aria-label={label}
      sx={theme => ({
        position: 'relative',
        width: { xs: '100%', sm: '17rem' },
        display: 'flex',
        alignItems: 'center',
        gap: 1.5,
        p: 1.5,
        borderRadius: 3,
        border: 1,
        borderColor: 'divider',
        bgcolor: 'background.paper',
        transition: theme.transitions.create(['border-color', 'box-shadow']),
        '&:hover, &:focus-within': {
          borderColor: 'primary.main',
          boxShadow: theme.vars.shadows[2]
        },
        '& a': { color: 'text.primary', textDecoration: 'none' },
        '& a::after': { content: '""', position: 'absolute', inset: 0 },
        '& a:focus-visible': { outline: 'none' }
      })}
    >
      <Avatar
        variant="rounded"
        size={40}
        color={nameToColor(label) ?? 'sunrise'}
        role={badgeLabel === undefined ? undefined : 'img'}
        aria-label={badgeLabel}
        aria-hidden={badgeLabel === undefined ? true : undefined}
        sx={{ borderRadius: 2, fontWeight: 600 }}
      >
        {badge}
      </Avatar>
      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Typography
          variant="subtitle1"
          component="h3"
          noWrap
          sx={{ fontWeight: 600 }}
        >
          {title}
        </Typography>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          {tag !== undefined && (
            <Typography
              variant="caption"
              sx={{
                px: 0.75,
                borderRadius: 1,
                fontWeight: 600,
                letterSpacing: '0.04em',
                color: 'text.secondary',
                bgcolor: 'action.hover'
              }}
            >
              {tag}
            </Typography>
          )}
          <Typography variant="caption" color="textSecondary" noWrap>
            {meta}
          </Typography>
        </Box>
      </Box>
      {action && <Box sx={{ position: 'relative', zIndex: 1 }}>{action}</Box>}
    </Box>
  )
}

export const ShelfTabs = styled(Tabs)(({ theme }) => ({
  [theme.breakpoints.up('sm')]: { width: 'fit-content' }
}))

// Shelves flow side by side, so short ones share a row.
export function Shelves({ children }: { children: ReactNode }): ReactElement {
  return (
    <Box
      sx={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'flex-start',
        columnGap: 4,
        rowGap: 3
      }}
    >
      {children}
    </Box>
  )
}

export function TileShelf({
  name,
  children
}: {
  name: string
  children: ReactNode
}): ReactElement {
  return (
    <Box
      component="section"
      sx={{ width: { xs: '100%', sm: 'auto' }, maxWidth: '100%', minWidth: 0 }}
    >
      <Typography variant="subtitle1" component="h2" sx={{ fontWeight: 600 }}>
        {name}
      </Typography>
      <Box
        component="ul"
        aria-label={name}
        sx={{
          listStyle: 'none',
          m: 0,
          mt: 1,
          p: 0,
          display: 'flex',
          flexWrap: 'wrap',
          gap: 2
        }}
      >
        {children}
      </Box>
    </Box>
  )
}

export function TileGrid({
  label,
  children
}: {
  label: string
  children: ReactNode
}): ReactElement {
  return (
    <Box
      component="ul"
      aria-label={label}
      sx={{
        listStyle: 'none',
        m: 0,
        p: 0,
        display: 'grid',
        gap: 2,
        gridTemplateColumns: 'repeat(auto-fill, minmax(14rem, 1fr))'
      }}
    >
      {children}
    </Box>
  )
}

export function Tile({ children }: { children: ReactNode }): ReactElement {
  return (
    <Box
      component="li"
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 1,
        p: 2,
        borderRadius: 2,
        border: 1,
        borderColor: 'divider',
        bgcolor: 'background.paper',
        '&:focus-within, &:hover': { borderColor: 'primary.main' }
      }}
    >
      {children}
    </Box>
  )
}

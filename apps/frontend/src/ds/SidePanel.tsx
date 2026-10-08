import {
  Box,
  Drawer,
  InputBase,
  MenuItem,
  Select,
  styled,
  Typography
} from '@linagora/twake-mui'
import type { ReactElement, ReactNode } from 'react'

export function SidePanel({
  label,
  onClose,
  header,
  children
}: {
  label: string
  onClose: () => void
  header: ReactNode
  children: ReactNode
}): ReactElement {
  return (
    <Drawer
      open
      anchor="right"
      onClose={onClose}
      slotProps={{
        paper: {
          role: 'dialog',
          'aria-label': label,
          'aria-modal': true,
          sx: {
            width: { xs: '100%', sm: 600 },
            display: 'flex',
            flexDirection: 'column'
          }
        }
      }}
    >
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 0.5,
          minHeight: 56,
          px: { xs: 2, sm: 3 },
          borderBottom: 1,
          borderColor: 'divider'
        }}
      >
        {header}
      </Box>
      <Box
        sx={{
          flex: 1,
          overflowY: 'auto',
          px: { xs: 2, sm: 3 },
          py: 2,
          display: 'flex',
          flexDirection: 'column',
          gap: 3
        }}
      >
        {children}
      </Box>
    </Drawer>
  )
}

export function Grow(): ReactElement {
  return <Box sx={{ flex: 1 }} />
}

export function Chips({
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
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: 0.5,
        '& > li': { display: 'inline-flex', alignItems: 'center' }
      }}
    >
      {children}
    </Box>
  )
}

export function Inline({ children }: { children: ReactNode }): ReactElement {
  return (
    <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 1 }}>
      {children}
    </Box>
  )
}

export function PropertySelect({
  labelId,
  value,
  options,
  onChange
}: {
  labelId: string
  value: string
  options: { value: string; label: string }[]
  onChange: (value: string) => void
}): ReactElement {
  return (
    <Select
      size="small"
      value={value}
      displayEmpty
      SelectDisplayProps={{ 'aria-labelledby': labelId }}
      onChange={event => {
        onChange(event.target.value)
      }}
      sx={theme => ({
        ...theme.typography.body2,
        ml: -1,
        '& .MuiSelect-select': { py: 0.75, pl: 1, minHeight: 'auto' },
        '& .MuiOutlinedInput-notchedOutline': { borderColor: 'transparent' },
        '&:hover': { bgcolor: 'action.hover' },
        '&:hover .MuiOutlinedInput-notchedOutline': {
          borderColor: 'transparent'
        }
      })}
    >
      {options.map(option => (
        <MenuItem key={option.value} value={option.value}>
          {option.label}
        </MenuItem>
      ))}
    </Select>
  )
}

export const TitleInput = styled(InputBase)(({ theme }) => ({
  ...theme.typography.h4,
  width: '100%',
  borderRadius: theme.shape.borderRadius,
  '& textarea': { padding: theme.spacing(0.5, 1) },
  marginLeft: theme.spacing(-1),
  '&:hover': { backgroundColor: theme.vars.palette.action.hover },
  '&.Mui-focused': {
    backgroundColor: 'transparent',
    boxShadow: `inset 0 0 0 2px ${theme.vars.palette.primary.main}`
  }
}))

export function Properties({
  children
}: {
  children: ReactNode
}): ReactElement {
  return (
    <Box
      component="dl"
      sx={{
        m: 0,
        display: 'grid',
        gridTemplateColumns: { xs: '6.5rem 1fr', sm: '9rem 1fr' },
        columnGap: 2,
        rowGap: 0.5,
        alignItems: 'center'
      }}
    >
      {children}
    </Box>
  )
}

export function Property({
  id,
  icon,
  label,
  children
}: {
  id?: string
  icon: ReactNode
  label: string
  children: ReactNode
}): ReactElement {
  return (
    <>
      <Box
        component="dt"
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          minHeight: 40,
          color: 'text.secondary',
          '& svg': { width: 16, height: 16, flexShrink: 0 }
        }}
      >
        {icon}
        <Typography id={id} variant="body2" color="inherit" noWrap>
          {label}
        </Typography>
      </Box>
      <Box
        component="dd"
        sx={{
          m: 0,
          minWidth: 0,
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: 1,
          minHeight: 40
        }}
      >
        {children}
      </Box>
    </>
  )
}

export function Feed({
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
        display: 'flex',
        flexDirection: 'column',
        gap: 2
      }}
    >
      {children}
    </Box>
  )
}

export function FeedItem({
  avatar,
  label,
  children
}: {
  avatar: ReactNode
  label?: string
  children: ReactNode
}): ReactElement {
  return (
    <Box
      component="li"
      aria-label={label}
      sx={{ display: 'flex', gap: 1.5, alignItems: 'flex-start' }}
    >
      <Box sx={{ pt: 0.25 }}>{avatar}</Box>
      <Box sx={{ minWidth: 0, flex: 1, '& p': { my: 0.5 } }}>{children}</Box>
    </Box>
  )
}

export function PanelSection({
  title,
  action,
  children
}: {
  title: string
  action?: ReactNode
  children: ReactNode
}): ReactElement {
  return (
    <Box component="section" aria-label={title}>
      <Box sx={{ display: 'flex', alignItems: 'center', mb: 1, gap: 1 }}>
        <Typography variant="subtitle1" component="h3" sx={{ flex: 1 }}>
          {title}
        </Typography>
        {action}
      </Box>
      {children}
    </Box>
  )
}

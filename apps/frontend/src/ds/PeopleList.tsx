import {
  Box,
  ListItem,
  ListItemAvatar,
  ListItemText
} from '@linagora/twake-mui'
import type { ReactElement, ReactNode } from 'react'

export function InviteRow({
  label,
  onSubmit,
  children
}: {
  label: string
  onSubmit: () => void
  children: ReactNode
}): ReactElement {
  return (
    <Box
      component="form"
      aria-label={label}
      onSubmit={event => {
        event.preventDefault()
        onSubmit()
      }}
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 2,
        // The field takes the room left: a TextField, or the Autocomplete
        // that wraps one to suggest people, where Twake Tasks has the
        // TextField alone.
        '& > .MuiTextField-root, & > .MuiAutocomplete-root': {
          flex: 1,
          minWidth: 0
        },
        '& > :not(.MuiTextField-root):not(.MuiAutocomplete-root)': {
          flexShrink: 0
        }
      }}
    >
      {children}
    </Box>
  )
}

export function PersonRow({
  label,
  detail,
  avatar,
  children
}: {
  label: string
  detail?: string | undefined
  avatar: ReactNode
  children: ReactNode
}): ReactElement {
  return (
    <ListItem aria-label={label} gutters="disabled">
      <ListItemAvatar sx={{ minWidth: 44 }}>{avatar}</ListItemAvatar>
      <ListItemText
        primary={label}
        secondary={detail}
        slotProps={{
          primary: { noWrap: true },
          secondary: { noWrap: true }
        }}
      />
      <Box
        sx={{ display: 'flex', alignItems: 'center', gap: 2, flexShrink: 0 }}
      >
        {children}
      </Box>
    </ListItem>
  )
}

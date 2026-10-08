import { Check, Icon, Plus } from '@linagora/twake-icons'
import {
  Box,
  Button,
  MenuItem,
  MenuList,
  Popover,
  Typography
} from '@linagora/twake-mui'
import {
  useRef,
  type KeyboardEvent,
  type ReactElement,
  type ReactNode
} from 'react'

import { SearchBar } from '@/ds/SearchBar'

export function PickerPopover({
  label,
  anchor,
  onClose,
  searchLabel,
  search,
  onSearch,
  onPickFirst,
  footer,
  children
}: {
  label: string
  anchor: HTMLElement | null
  onClose: () => void
  searchLabel: string
  search: string
  onSearch: (search: string) => void
  onPickFirst?: () => void
  footer?: ReactNode
  children: ReactNode
}): ReactElement {
  const searchRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLUListElement>(null)

  const onSearchKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      listRef.current
        ?.querySelector<HTMLElement>(
          '[role^="menuitem"]:not([aria-disabled="true"])'
        )
        ?.focus()
    } else if (event.key === 'Enter' && onPickFirst) {
      event.preventDefault()
      onPickFirst()
    }
  }

  return (
    <Popover
      open={anchor !== null}
      anchorEl={anchor}
      onClose={onClose}
      disableAutoFocus
      anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
      slotProps={{
        transition: {
          onEntering: () => {
            searchRef.current?.focus()
          }
        },
        paper: {
          role: 'dialog',
          'aria-label': label,
          sx: { width: 300, maxWidth: 'calc(100vw - 32px)' }
        }
      }}
    >
      <Box sx={{ p: 1.5, pb: 0.5 }}>
        <SearchBar
          size="small"
          elevation={0}
          placeholder={searchLabel}
          value={search}
          onChange={event => {
            onSearch(event.target.value)
          }}
          onClear={() => {
            onSearch('')
          }}
          componentsProps={{
            inputBase: {
              inputRef: searchRef,
              inputProps: {
                'aria-label': searchLabel,
                maxLength: 50,
                onKeyDown: onSearchKeyDown
              }
            }
          }}
        />
      </Box>
      <MenuList
        ref={listRef}
        dense
        aria-label={label}
        sx={{ maxHeight: 320, overflowY: 'auto' }}
      >
        {children}
      </MenuList>
      {footer && <Box sx={{ px: 2, pb: 1.5 }}>{footer}</Box>}
    </Popover>
  )
}

export function PickerOption({
  checked,
  onToggle,
  start,
  children
}: {
  checked: boolean
  onToggle: () => void
  start?: ReactNode
  children: ReactNode
}): ReactElement {
  return (
    <MenuItem
      role="menuitemcheckbox"
      aria-checked={checked}
      onClick={onToggle}
      sx={{ gap: 1.5 }}
    >
      {start}
      <Box sx={{ flex: 1, minWidth: 0 }} className="u-ellipsis">
        {children}
      </Box>
      <Box
        component="span"
        sx={{ display: 'flex', color: 'primary.main', width: 16 }}
      >
        {checked && <Icon icon={Check} size={16} />}
      </Box>
    </MenuItem>
  )
}

export function PickerCreate({
  onCreate,
  disabled,
  children
}: {
  onCreate: () => void
  disabled: boolean
  children: ReactNode
}): ReactElement {
  return (
    <MenuItem
      onClick={onCreate}
      disabled={disabled}
      sx={{ gap: 1.5, color: 'primary.main' }}
    >
      <Icon icon={Plus} size={16} />
      <Box sx={{ flex: 1, minWidth: 0 }} className="u-ellipsis">
        {children}
      </Box>
    </MenuItem>
  )
}

export function PickerEmpty({
  children
}: {
  children: ReactNode
}): ReactElement {
  return (
    <Typography
      component="li"
      variant="body2"
      color="textSecondary"
      sx={{ px: 2, py: 1 }}
    >
      {children}
    </Typography>
  )
}

export function PickerError({
  retryLabel,
  onRetry,
  children
}: {
  retryLabel: string
  onRetry: () => void
  children: ReactNode
}): ReactElement {
  return (
    <Box role="alert" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
      <Typography variant="caption" color="error" sx={{ flex: 1 }}>
        {children}
      </Typography>
      <Button size="small" variant="text" onClick={onRetry}>
        {retryLabel}
      </Button>
    </Box>
  )
}

import { Burger, Icon } from '@linagora/twake-icons'
import {
  Box,
  Drawer,
  IconButton,
  useMediaQuery,
  type Theme
} from '@linagora/twake-mui'
import type { ReactElement, ReactNode } from 'react'

// Below md the sidebar would push the content under the fold, so it waits in a
// drawer the menu button opens.
export function WikiFrame({
  sidebar,
  menuLabel,
  menuOpen,
  onMenuOpenChange,
  children
}: {
  sidebar: ReactNode
  menuLabel: string
  menuOpen: boolean
  onMenuOpenChange: (open: boolean) => void
  children: ReactNode
}): ReactElement {
  const narrow = useMediaQuery((theme: Theme) => theme.breakpoints.down('md'), {
    noSsr: true
  })

  // The page keeps its place in the tree at both widths, so turning a tablet
  // does not remount it and drop what it holds.
  return (
    <Box sx={{ display: 'flex', minHeight: '100%' }}>
      {!narrow && (
        <Box
          sx={{
            flex: '0 0 260px',
            borderRight: 1,
            borderColor: 'divider'
          }}
        >
          {sidebar}
        </Box>
      )}
      <Box sx={{ flex: '1 1 auto', minWidth: 0 }}>
        {narrow && (
          <Box sx={{ px: 1, pt: 1 }}>
            <IconButton
              aria-label={menuLabel}
              aria-expanded={menuOpen}
              onClick={() => {
                onMenuOpenChange(true)
              }}
            >
              <Icon icon={Burger} />
            </IconButton>
          </Box>
        )}
        {children}
      </Box>
      {narrow && (
        <Drawer
          anchor="left"
          open={menuOpen}
          onClose={() => {
            onMenuOpenChange(false)
          }}
          // Kept mounted so the tree keeps the branches opened in it.
          ModalProps={{ keepMounted: true }}
          slotProps={{ paper: { sx: { width: 300, maxWidth: '85vw' } } }}
        >
          {sidebar}
        </Drawer>
      )}
    </Box>
  )
}

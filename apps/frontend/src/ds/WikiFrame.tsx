import { Box } from '@linagora/twake-mui'
import type { ReactElement, ReactNode } from 'react'

// The wiki's own column, for its tree, beside the screen; above it on phones.
export function WikiFrame({
  sidebar,
  children
}: {
  sidebar: ReactNode
  children: ReactNode
}): ReactElement {
  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: { xs: 'column', md: 'row' },
        minHeight: '100%'
      }}
    >
      <Box
        sx={{
          flex: { md: '0 0 260px' },
          borderBottom: { xs: 1, md: 0 },
          borderRight: { md: 1 },
          borderColor: 'divider'
        }}
      >
        {sidebar}
      </Box>
      <Box sx={{ flex: '1 1 auto', minWidth: 0 }}>{children}</Box>
    </Box>
  )
}

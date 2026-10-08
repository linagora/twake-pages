import { Box, Typography } from '@linagora/twake-mui'
import type { ReactElement, ReactNode, SubmitEvent } from 'react'

export function FormPanel({
  title,
  onSubmit,
  actions,
  children
}: {
  title: string
  onSubmit: (event: SubmitEvent<HTMLFormElement>) => void
  actions: ReactNode
  children: ReactNode
}): ReactElement {
  return (
    <Box
      component="form"
      onSubmit={onSubmit}
      sx={{
        mt: 4,
        p: 3,
        border: 1,
        borderColor: 'divider',
        borderRadius: 3,
        bgcolor: 'background.paper'
      }}
    >
      <Typography
        variant="subtitle1"
        component="h2"
        sx={{ fontWeight: 600, mb: 2 }}
      >
        {title}
      </Typography>
      <Box
        sx={{
          display: 'grid',
          gap: 2,
          gridTemplateColumns: 'repeat(auto-fit, minmax(11rem, 1fr))'
        }}
      >
        {children}
      </Box>
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'flex-end',
          gap: 2,
          mt: 2
        }}
      >
        {actions}
      </Box>
    </Box>
  )
}

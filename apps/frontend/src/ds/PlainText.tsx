import { Typography } from '@linagora/twake-mui'
import type { ReactElement, ReactNode } from 'react'

/**
 * Text written plain, with its line breaks and spaces as typed, where Twake
 * Tasks shows Markdown. A long address breaks rather than overflows.
 */
export function PlainText({ children }: { children: ReactNode }): ReactElement {
  return (
    <Typography
      variant="body2"
      sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}
    >
      {children}
    </Typography>
  )
}
